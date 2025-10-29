const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure Multer with Cloudinary Storage
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'paint-shop/colors',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }]
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/colorshop', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB');
});

// Product Schema (Updated)
const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  brand: { type: String, required: true },
  color: String,
  colorCode: String, // Hex code like "#FF5733"
  colorImageUrl: String, // Cloudinary URL
  colorImagePublicId: String, // Cloudinary public ID for deletion
  size: String,
  quantity: { type: Number, required: true, default: 0 },
  price: { type: Number, required: true },
  category: String,
  description: String,
  lastUpdated: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// Admin Schema
const adminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true }
});

const Admin = mongoose.model('Admin', adminSchema);

// ===== PUBLIC ROUTES =====

// Get all products
app.get('/api/products', async (req, res) => {
  try {
    const products = await Product.find().sort({ lastUpdated: -1 });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single product
app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Search products
app.get('/api/products/search/:query', async (req, res) => {
  try {
    const query = req.params.query;
    const products = await Product.find({
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { brand: { $regex: query, $options: 'i' } },
        { category: { $regex: query, $options: 'i' } },
        { color: { $regex: query, $options: 'i' } }
      ]
    });
    res.json(products);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ===== ADMIN ROUTES =====

// Admin Login
app.post('/api/admin/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    
    if (!admin) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    res.json({ message: 'Login successful', username: admin.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Create Product with Image Upload (Admin)
app.post('/api/admin/products', upload.single('colorImage'), async (req, res) => {
  try {
    const productData = {
      name: req.body.name,
      brand: req.body.brand,
      color: req.body.color,
      colorCode: req.body.colorCode,
      size: req.body.size,
      quantity: req.body.quantity,
      price: req.body.price,
      category: req.body.category,
      description: req.body.description
    };

    // If image was uploaded, add Cloudinary URL and public ID
    if (req.file) {
      productData.colorImageUrl = req.file.path;
      productData.colorImagePublicId = req.file.filename;
    }

    const product = new Product(productData);
    const newProduct = await product.save();
    res.status(201).json(newProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Update Product with Image Upload (Admin)
app.put('/api/admin/products/:id', upload.single('colorImage'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    // If new image is uploaded, delete old image from Cloudinary
    if (req.file && product.colorImagePublicId) {
      try {
        await cloudinary.uploader.destroy(product.colorImagePublicId);
      } catch (error) {
        console.error('Error deleting old image:', error);
      }
    }

    // Update fields
    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        product[key] = req.body[key];
      }
    });

    // Update image URL and public ID if new image uploaded
    if (req.file) {
      product.colorImageUrl = req.file.path;
      product.colorImagePublicId = req.file.filename;
    }
    
    product.lastUpdated = Date.now();
    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete Product (Admin)
app.delete('/api/admin/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });
    
    // Delete image from Cloudinary if exists
    if (product.colorImagePublicId) {
      try {
        await cloudinary.uploader.destroy(product.colorImagePublicId);
      } catch (error) {
        console.error('Error deleting image from Cloudinary:', error);
      }
    }
    
    await Product.deleteOne({ _id: req.params.id });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Upload/Update only image for existing product
app.post('/api/admin/products/:id/image', upload.single('colorImage'), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ message: 'Product not found' });

    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    // Delete old image if exists
    if (product.colorImagePublicId) {
      try {
        await cloudinary.uploader.destroy(product.colorImagePublicId);
      } catch (error) {
        console.error('Error deleting old image:', error);
      }
    }

    product.colorImageUrl = req.file.path;
    product.colorImagePublicId = req.file.filename;
    product.lastUpdated = Date.now();

    const updatedProduct = await product.save();
    res.json(updatedProduct);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Initialize Admin (Run once to create admin account)
app.post('/api/admin/init', async (req, res) => {
  try {
    const existingAdmin = await Admin.findOne({ username: 'admin' });
    if (existingAdmin) {
      return res.status(400).json({ message: 'Admin already exists' });
    }

    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = new Admin({
      username: 'admin',
      password: hashedPassword
    });

    await admin.save();
    res.json({ message: 'Admin created. Username: admin, Password: admin123. CHANGE THIS!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
