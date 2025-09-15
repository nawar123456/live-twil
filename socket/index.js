// socket.js - إدارة اتصالات الوقت الفعلي (WebSocket) مع Twilio
const Message = require('../models/Message');
const Stream = require('../models/Stream');
const User = require('../models/User');
const mongoose = require('mongoose');
const twilio = require('twilio');

// إعداد Twilio Client
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(accountSid, authToken);

// تخزين معلومات الغرف المؤقتة (للاستخدام التجريبي، استخدم Redis/DB للإنتاج)
// الصيغة: { streamId: { roomId, participants: [] } }
const twilioRooms = {};

module.exports = (io) => {
  io.on('connection', (socket) => {
    console.log('🔌 اتصال جديد:', socket.id);

    // انضمام مستخدم لغرفة بث
    socket.on('join_stream', async ({ streamId, userId }) => {
      try {
        console.log('[DEBUG] انضمام لغرفة البث:', { streamId, userId });

        // التحقق من صحة المدخلات
        if (!streamId || !userId) {
          const errorMsg = 'معرف البث ومعرف المستخدم مطلوبان';
          console.log('[ERROR]', errorMsg);
          return socket.emit('error', { message: errorMsg });
        }

        // التحقق من صحة معرف البث (ObjectId)
        if (!mongoose.Types.ObjectId.isValid(streamId)) {
          const errorMsg = `صيغة معرف البث غير صحيحة: ${streamId}`;
          console.log('[ERROR]', errorMsg);
          return socket.emit('error', { message: errorMsg });
        }

        // البحث عن البث في قاعدة البيانات
        let stream;
        try {
          stream = await Stream.findById(streamId);
          console.log('[DEBUG] نتيجة البحث عن البث:', stream ? 'موجود' : 'غير موجود');
        } catch (lookupErr) {
          console.log('[ERROR] فشل البحث عن البث:', lookupErr.message);
          return socket.emit('error', { message: 'فشل البحث في قاعدة البيانات: ' + lookupErr.message });
        }

        // التحقق من وجود البث
        if (!stream) {
          const errorMsg = `البث غير موجود: ${streamId}`;
          console.log('[ERROR]', errorMsg);
          return socket.emit('error', { message: errorMsg });
        }

        console.log('[DEBUG] تم العثور على البث:', stream._id);

        // انضمام المستخدم لغرفة البث (Socket.IO Room)
        socket.join(streamId);
        console.log('[DEBUG] انضم المستخدم للغرفة:', streamId);

        // تحديث عدد المشاهدين في قاعدة البيانات
        try {
          // استخدام $addToSet لتجنب التكرار
          await Stream.findByIdAndUpdate(streamId, { $addToSet: { viewers: userId } });
          const updatedStream = await Stream.findById(streamId);
          // إرسال تحديث عدد المشاهدين لجميع المستخدمين في الغرفة
          io.to(streamId).emit('viewer_count', { count: updatedStream.viewers.length });
          console.log('[DEBUG] تم تحديث عدد المشاهدين');
        } catch (dbErr) {
          console.log('[WARN] فشل تحديث قاعدة البيانات (الاستمرار):', dbErr.message);
        }

        // ✅ إنشاء أو الانضمام لغرفة Twilio
        try {
          // التحقق من وجود غرفة Twilio
          if (!twilioRooms[streamId]) {
            // إنشاء غرفة Twilio جديدة
            const room = await twilioClient.video.rooms.create({
              uniqueName: streamId, // استخدام نفس Stream ID
              type: 'group', // أو 'peer-to-peer'
              maxParticipants: 50,
              statusCallback: 'https://live-node.onrender.com/twilio/status' // (اختياري)
            });
            
            twilioRooms[streamId] = {
              roomId: room.sid,
              participants: []
            };
            
            console.log(`[TWILIO] غرفة أُنشئت: ${room.sid} لـ streamId: ${streamId}`);
          }
          
          // إضافة المستخدم لقائمة المشاركين
          twilioRooms[streamId].participants.push({
            socketId: socket.id,
            userId: userId,
            role: 'viewer'
          });
          
          // إرسال معلومات الغرفة للمستخدم
          socket.emit('twilio_room_info', {
            roomId: twilioRooms[streamId].roomId,
            streamId: streamId
          });
          
          console.log(`[join_stream] المستخدم ${userId} انضم للغرفة Twilio ${twilioRooms[streamId].roomId}`);
          
        } catch (twilioErr) {
          console.log('[WARN] مشكلة في Twilio Room (الاستمرار):', twilioErr.message);
          // ممكن نكمل بدون Twilio Room إذا في مشكلة
        }

        console.log(`[join_stream] المستخدم ${userId} انضم للبث ${streamId}`);

      } catch (err) {
        console.error('[ERROR] في انضمام المستخدم للبث:', err);
        socket.emit('error', { message: 'فشل الانضمام للبث: ' + err.message });
      }
    });

    // مغادرة مستخدم لغرفة بث
    socket.on('leave_stream', async ({ streamId, userId }) => {
      try {
        // التحقق من صحة المدخلات
        if (!streamId || !userId) {
          return socket.emit('error', { message: 'معرف البث ومعرف المستخدم مطلوبان' });
        }

        // مغادرة الغرفة
        socket.leave(streamId);

        // إزالة المستخدم من قائمة المشاهدين في قاعدة البيانات
        await Stream.findByIdAndUpdate(streamId, { $pull: { viewers: userId } });

        // إرسال تحديث عدد المشاهدين
        const stream = await Stream.findById(streamId);
        io.to(streamId).emit('viewer_count', { count: stream.viewers.length });

        // ✅ إزالة المستخدم من غرفة Twilio
        if (twilioRooms[streamId]) {
          twilioRooms[streamId].participants = 
            twilioRooms[streamId].participants.filter(p => p.socketId !== socket.id);
          
          console.log(`[leave_stream] المستخدم ${userId} غادر غرفة Twilio`);
        }

        console.log(`[leave_stream] المستخدم ${userId} غادر البث ${streamId}`);
      } catch (err) {
        console.error('خطأ في مغادرة البث:', err);
        socket.emit('error', { message: 'فشل مغادرة البث' });
      }
    });

    // إرسال رسالة دردشة مباشرة
    socket.on('send_message', async ({ streamId, userId, content, type }) => {
      try {
        // التحقق من صحة المدخلات
        if (!streamId || !userId || !content) {
          return socket.emit('error', { message: 'معرف البث ومعرف المستخدم والمحتوى مطلوبة' });
        }

        // حفظ الرسالة في قاعدة البيانات
        const message = await Message.create({
          streamId,
          userId,
          content,
          type: type || 'text', // نوع الرسالة (نص، صورة، إلخ)
          filtered: false       // هل تم تصفية الرسالة من الكلمات السيئة؟
        });

        // إرسال الرسالة لجميع المستخدمين في الغرفة
        io.to(streamId).emit('new_message', {
          _id: message._id,
          streamId,
          userId,
          content,
          type: message.type,
          timestamp: message.timestamp
        });

        console.log(`[send_message] تم إرسال رسالة في البث ${streamId} من المستخدم ${userId}`);
      } catch (err) {
        console.error('خطأ في إرسال الرسالة:', err);
        socket.emit('error', { message: 'فشل إرسال الرسالة' });
      }
    });

    // تحديث حالة البث (بدء/إيقاف)
    socket.on('stream_status', ({ streamId, status }) => {
      // التحقق من صحة المدخلات
      if (!streamId || !status) {
        return socket.emit('error', { message: 'معرف البث والحالة مطلوبة' });
      }

      // إرسال تحديث الحالة لجميع المستخدمين في الغرفة
      // status: 'start' | 'stop'
      io.to(streamId).emit('stream_status', { streamId, status });
      console.log(`[stream_status] حالة البث ${streamId}: ${status}`);
    });

    // ✅ حدث جديد لإنشاء غرفة Twilio (من البثّاث)
    socket.on('create_twilio_room', async ({ streamId, userId }) => {
      try {
        if (!streamId || !userId) {
          return socket.emit('error', { message: 'معرف البث ومعرف المستخدم مطلوبان' });
        }

        // إنشاء غرفة Twilio
        const room = await twilioClient.video.rooms.create({
          uniqueName: streamId,
          type: 'group',
          maxParticipants: 50
        });

        // تخزين معلومات الغرفة
        twilioRooms[streamId] = {
          roomId: room.sid,
          participants: [{
            socketId: socket.id,
            userId: userId,
            role: 'broadcaster'
          }]
        };

        // إرسال معلومات الغرفة للبثّاث
        socket.emit('twilio_room_created', {
          roomId: room.sid,
          streamId: streamId,
          roomName: room.uniqueName
        });

        console.log(`[TWILIO] غرفة أُنشئت للبثّاث ${userId}: ${room.sid}`);
        
      } catch (err) {
        console.error('[TWILIO ERROR] في إنشاء الغرفة:', err);
        socket.emit('error', { message: 'فشل إنشاء غرفة Twilio: ' + err.message });
      }
    });

    // ✅ حدث جديد لتحديث حالة المشاركين
    socket.on('participant_status', ({ streamId, userId, status }) => {
      try {
        if (!streamId || !userId || !status) {
          return socket.emit('error', { message: 'جميع الحقول مطلوبة' });
        }

        // تحديث حالة المشارك في الذاكرة
        if (twilioRooms[streamId]) {
          const participant = twilioRooms[streamId].participants.find(p => p.userId === userId);
          if (participant) {
            participant.status = status; // connected, disconnected, etc.
          }
        }

        // إرسال تحديث الحالة لجميع المستخدمين
        io.to(streamId).emit('participant_status_update', {
          userId,
          status,
          timestamp: new Date()
        });

        console.log(`[participant_status] حالة المشارك ${userId}: ${status}`);
        
      } catch (err) {
        console.error('خطأ في تحديث حالة المشارك:', err);
      }
    });

    // تنظيف عند قطع الاتصال
    socket.on('disconnect', (reason) => {
      console.log(`🔌 Socket disconnected: ${socket.id}, reason: ${reason}`);

      // إزالة معرف الاتصال من جميع القوائم
      Object.keys(twilioRooms).forEach(streamId => {
        const streamRoom = twilioRooms[streamId];
        
        // إزالة المستخدم من قائمة المشاركين
        streamRoom.participants = streamRoom.participants.filter(p => p.socketId !== socket.id);
        
        // إذا كان البثّاث منقطع الاتصال، إزالة الغرفة
        const broadcaster = streamRoom.participants.find(p => p.role === 'broadcaster' && p.socketId === socket.id);
        if (broadcaster) {
          delete twilioRooms[streamId];
          io.to(streamId).emit('broadcaster_disconnected', { streamId });
          console.log(`[disconnect] البثّاث انقطع الاتصال، تم إزالة الغرفة للبث ${streamId}`);
        }
      });
    });
  });
};