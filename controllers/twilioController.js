// controllers/twilioController.js
const twilio = require('twilio');

// ✅ تعريف twilioClient بشكل صحيح
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioClient = twilio(accountSid, authToken);

// إنشاء غرفة Twilio Video ✅ مع معالجة الأخطاء
const createVideoRoom = async (req, res, next) => {
  try {
    const { roomName } = req.body;

    // ✅ التحقق من صحة المدخلات
    if (!roomName) {
      return res.status(400).json({ 
        success: false, 
        error: 'roomName مطلوب' 
      });
    }

    try {
      // ✅ محاولة إنشاء الغرفة
      const room = await twilioClient.video.v1.rooms.create({
        uniqueName: roomName,
        type: 'group',
        maxParticipants: 50,
        // ✅ إضافة timeout أطول
        timeout: 30000
      });

      console.log(`[TWILIO] غرفة أُنشئت: ${room.sid}`);
      res.json({ 
        success: true,
        roomId: room.sid,
        roomName: room.uniqueName,
        message: 'غرفة أُنشئت بنجاح'
      });

    } catch (createErr) {
      // ✅ إذا الغرفة موجودة، نستخدمها
      if (createErr.code === 53113 || createErr.status === 400) {
        console.log(`[TWILIO] الغرفة موجودة بالفعل: ${roomName}`);
        
        // جلب معلومات الغرفة الموجودة
        try {
          const existingRoom = await twilioClient.video.v1.rooms(roomName).fetch();
          
          // إذا الغرفة مكتملة، ننشئ غرفة جديدة
          if (existingRoom.status === 'completed') {
            const newRoom = await twilioClient.video.v1.rooms.create({
              uniqueName: `${roomName}_${Date.now()}`, // اسم جديد
              type: 'group',
              maxParticipants: 50
            });
            
            console.log(`[TWILIO] غرفة جديدة أُنشئت: ${newRoom.sid}`);
            res.json({ 
              success: true,
              roomId: newRoom.sid,
              roomName: newRoom.uniqueName,
              message: 'غرفة جديدة أُنشئت (السابقة مكتملة)'
            });
          } else {
            // استخدام الغرفة الموجودة
            res.json({ 
              success: true,
              roomId: existingRoom.sid,
              roomName: existingRoom.uniqueName,
              message: 'جارٍ استخدام الغرفة الموجودة'
            });
          }
        } catch (fetchErr) {
          throw fetchErr;
        }
      } else {
        // أي خطأ تاني
        throw createErr;
      }
    }

  } catch (error) {
    console.error('[TWILIO ERROR] في إنشاء الغرفة:', {
      message: error.message,
      code: error.code,
      status: error.status,
      moreInfo: error.moreInfo
    });
    
    res.status(500).json({ 
      success: false,
      error: error.message,
      code: error.code,
      status: error.status
    });
  }
};

// إنشاء Access Token ✅ بالطريقة الصحيحة
const generateAccessToken = async (req, res, next) => {
  try {
    const { identity, roomName } = req.body;

    if (!identity) {
      return res.status(400).json({ 
        success: false, 
        error: 'identity مطلوب' 
      });
    }

    // ✅ التحقق من المتغيرات البيئية
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const apiKeySid = process.env.TWILIO_API_KEY_SID;
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({ 
        success: false, 
        error: 'متغيرات Twilio البيئية مطلوبة' 
      });
    }

    // ✅ إنشاء AccessToken بالطريقة الصحيحة
    const accessToken = new twilio.jwt.AccessToken(
      accountSid,
      apiKeySid,      // ✅ مهم جداً
      apiKeySecret,   // ✅ مهم جداً
      { 
        identity: identity, 
        ttl: 3600 // ساعة واحدة
      }
    );

    // ✅ إعطاء صلاحية للدخول لغرفة معينة
    const videoGrant = new twilio.jwt.AccessToken.VideoGrant({
      room: roomName
    });
    accessToken.addGrant(videoGrant);

    res.json({
      success: true,
      token: accessToken.toJwt()
    });

  } catch (error) {
    console.error('[TWILIO ERROR] في إنشاء التوكن:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
};

module.exports = {
  createVideoRoom,
  generateAccessToken
};