// routes/stream.js - إدارة عمليات البث
const express = require('express');
const Stream = require('../models/Stream');
const User = require('../models/User');
const auth = require('../middleware/auth');
const router = express.Router();
const mongoose = require('mongoose');

// POST /stream/create - بدء بث جديد (يحتاج مصادقة)
router.post('/create', auth, async (req, res, next) => {
  try {
    // ✅ تشخيص المشكلة
    console.log('[DEBUG] req.body:', req.body);
    console.log('[DEBUG] req.headers:', req.headers);
    console.log('[DEBUG] Content-Type:', req.headers['content-type']);
    
    // ✅ التحقق من وجود req.body
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ 
        error: 'Request body is required',
        debug: {
          bodyExists: !!req.body,
          bodyKeys: req.body ? Object.keys(req.body) : null,
          contentType: req.headers['content-type']
        }
      });
    }
    
    const { title, category, tags, type, thumbnail } = req.body;
    
    // ✅ التحقق من الحقول المطلوبة
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const stream = await Stream.create({
      userId: req.user.id,
      title,
      category,
      tags,
      type,
      thumbnail,
      isLive: true,
      startTime: new Date()
    });
    res.json({ stream });
  } catch (err) { 
    console.error('[ERROR] في إنشاء البث:', err);
    next(err); 
  }
});

// POST /stream/end - إنهاء بث (يحتاج مصادقة، المالك فقط)
router.post('/end', auth, async (req, res, next) => {
  try {
    const { streamId } = req.body;
    const stream = await Stream.findById(streamId);
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    if (String(stream.userId) !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    stream.isLive = false;
    stream.endTime = new Date();
    await stream.save();
    res.json({ message: 'Stream ended' });
  } catch (err) { next(err); }
});

// GET /stream/list - قائمة البثوث المباشرة
router.get('/list', async (req, res, next) => {
  try {
    const streams = await Stream.find({ isLive: true })
      .populate('userId', 'username avatar')
      .sort({ startTime: -1 });
    res.json({ streams });
  } catch (err) { next(err); }
});

// GET /stream/:id - تفاصيل بث (يزيد عدد المشاهدات)
router.get('/:id', async (req, res, next) => {
  try {
    const stream = await Stream.findById(req.params.id).populate('userId', 'username avatar');
    if (!stream) return res.status(404).json({ error: 'Stream not found' });
    stream.viewCount = (stream.viewCount || 0) + 1;
    await stream.save();
    res.json({ stream });
  } catch (err) { next(err); }
});

// GET /stream/trending - البثوث الشائعة (الأكثر مشاهدة)
router.get('/trending', async (req, res, next) => {
  try {
    const streams = await Stream.find({ isLive: true })
      .sort({ viewers: -1, viewCount: -1 })
      .limit(10)
      .populate('userId', 'username avatar');
    res.json({ streams });
  } catch (err) { next(err); }
});

// GET /stream/search?q=term - البحث في البثوث
router.get('/search', async (req, res, next) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ streams: [] });
    const streams = await Stream.find({
      isLive: true,
      $or: [
        { title: { $regex: q, $options: 'i' } },
        { tags: { $regex: q, $options: 'i' } },
        { type: { $regex: q, $options: 'i' } }
      ]
    }).populate('userId', 'username avatar');
    res.json({ streams });
  } catch (err) { next(err); }
});

// ✅ POST /stream/create-test-simple - إنشاء بث تجريبي (بدون مصادقة - للاختبار فقط)
router.post('/create-test-simple', async (req, res, next) => {
  try {
    const { streamId, title, userId } = req.body;
    
    // تحديد قيم افتراضية صحيحة للـ enum
    const validCategory = 'gaming'; // أو أي قيمة موجودة في قاعدة البيانات
    const validType = 'Game'; // من الـ enum: ['Game', 'Music', 'Review', 'Talk', 'Other']
    
    const stream = await Stream.findByIdAndUpdate(
      streamId || `test_stream_${Date.now()}`,
      {
        userId: userId || 'test_user',
        title: title || 'Test Stream',
        category: validCategory,
        tags: ['test'],
        type: validType,
        isLive: true,
        startTime: new Date(),
        viewers: []
      },
      { upsert: true, new: true, runValidators: false } // تعطيل التحقق مؤقتاً لتجنب الأخطاء
    );
    
    res.json({ 
      message: '✅ Test stream created successfully',
      streamId: stream._id,
      stream 
    });
  } catch (err) { 
    console.error('Error creating test stream:', err);
    res.status(500).json({ error: err.message });
  }
});

// ✅ POST /stream/join - انضمام لغرفة بث (بدون مصادقة - للجميع)
router.post('/join', async (req, res, next) => {
  try {
    const { streamId, userId } = req.body;
    
    // التحقق من صحة المدخلات
    if (!streamId || !userId) {
      return res.status(400).json({ error: 'streamId and userId are required' });
    }
    
    // التحقق من صحة معرف البث
    if (!mongoose.Types.ObjectId.isValid(streamId)) {
      return res.status(400).json({ error: 'Invalid streamId format' });
    }
    
    // البحث عن البث
    const stream = await Stream.findById(streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    // انضمام المستخدم لغرفة البث
    // (في هذا السياق، نضيف المستخدم لقائمة المشاهدين)
    await Stream.findByIdAndUpdate(streamId, { $addToSet: { viewers: userId } });
    
    // تحديث عدد المشاهدين
    const updatedStream = await Stream.findById(streamId);
    
    res.json({ 
      message: '✅ Joined stream successfully',
      streamId: streamId,
      viewerCount: updatedStream.viewers.length
    });
    
    console.log(`[join_stream] User ${userId} joined stream ${streamId}`);
    
  } catch (err) {
    console.error('[ERROR] in join stream:', err);
    next(err);
  }
});

// ✅ POST /stream/leave - مغادرة غرفة بث (بدون مصادقة - للجميع)
router.post('/leave', async (req, res, next) => {
  try {
    const { streamId, userId } = req.body;
    
    // التحقق من صحة المدخلات
    if (!streamId || !userId) {
      return res.status(400).json({ error: 'streamId and userId are required' });
    }
    
    // التحقق من صحة معرف البث
    if (!mongoose.Types.ObjectId.isValid(streamId)) {
      return res.status(400).json({ error: 'Invalid streamId format' });
    }
    
    // البحث عن البث
    const stream = await Stream.findById(streamId);
    if (!stream) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    
    // مغادرة المستخدم من غرفة البث
    // (في هذا السياق، نزيل المستخدم من قائمة المشاهدين)
    await Stream.findByIdAndUpdate(streamId, { $pull: { viewers: userId } });
    
    // تحديث عدد المشاهدين
    const updatedStream = await Stream.findById(streamId);
    
    res.json({ 
      message: '✅ Left stream successfully',
      streamId: streamId,
      viewerCount: updatedStream.viewers.length
    });
    
    console.log(`[leave_stream] User ${userId} left stream ${streamId}`);
    
  } catch (err) {
    console.error('[ERROR] in leave stream:', err);
    next(err);
  }
});

module.exports = router;