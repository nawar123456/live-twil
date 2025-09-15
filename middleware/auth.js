// middleware/auth.js
const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // ✅ التصحيح المهم: استخدام `id` مباشرة من `decoded`
    req.user = { id: decoded.id };
    
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};