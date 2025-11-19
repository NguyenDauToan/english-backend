// src/routes/chatSupport.js
import express from "express";
import OpenAI from "openai";
import { verifyToken } from "../middleware/auth.js";
import Test from "../models/test.js";
import MockExam from "../models/mockExam.js";

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -----------------------------------------------------
// 1. Hàm detect xin đáp án đề thi
// -----------------------------------------------------
function isAskingForAnswer(text = "") {
  const lower = text.toLowerCase();

  const hasAnswerKeywords =
    lower.includes("đáp án") ||
    lower.includes("đúng hay sai") ||
    lower.includes("chọn đáp án") ||
    lower.includes("đáp số") ||
    lower.includes("lời giải chi tiết") ||
    lower.includes("giải chi tiết") ||
    lower.includes("hướng dẫn làm từng câu");

  // Pattern kiểu: "câu 1 là gì", "câu 3 chọn đáp án nào", ...
  const regexQuestionNumber =
    /(câu\s*\d+\s*(là gì|đáp án|chọn|đúng|sai|a|b|c|d))/i;

  return hasAnswerKeywords || regexQuestionNumber.test(lower);
}

// -----------------------------------------------------
// 2. Hàm detect câu hỏi ngoài phạm vi hệ thống
//    (hỏi không liên quan tới luyện thi / hệ thống)
// -----------------------------------------------------
function isOutOfScope(text = "") {
  const lower = text.toLowerCase();

  const allowedKeywords = [
    // tài khoản / đăng nhập
    "tài khoản",
    "đăng ký",
    "đăng nhập",
    "quên mật khẩu",

    // chức năng hệ thống
    "hệ thống luyện thi",
    "giao diện",
    "bị lỗi",
    "không vào được",
    "lỗi hệ thống",
    "không làm được bài",
    "không nộp được bài",

    // luyện thi & đề thi
    "luyện thi",
    "làm đề",
    "đề thi",
    "bài thi",
    "kết quả",
    "xem điểm",
    "thời gian làm bài",
    "nộp bài",
    "thi thử",
    "mock exam",

    // kỹ năng
    "listening",
    "reading",
    "speaking",
    "writing",

    // thi thpt quốc gia (nhiều cách viết)
    "thptqg",
    "thpt qg",
    "thpt quốc gia",
    "thi thpt",
    "thi tốt nghiệp",
    "thi quốc gia",

    // năm đề
    "2023",
    "2024",
    "2025",
    "2026",
    "năm 2023",
    "năm 2024",
    "năm 2025",
    "năm 2026",
  ];

  const hasAllowed = allowedKeywords.some((kw) => lower.includes(kw));
  // Nếu không chứa từ khóa nào liên quan → ngoài phạm vi
  return !hasAllowed;
}

// -----------------------------------------------------
// 3. Route /api/chat/support
// -----------------------------------------------------
router.post("/support", verifyToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || !message.trim()) {
      return res
        .status(400)
        .json({ reply: "Vui lòng nhập nội dung câu hỏi." });
    }

    // 1) Chặn xin đáp án
    if (isAskingForAnswer(message)) {
      return res.json({
        reply:
          "Xin lỗi, trợ lý không cung cấp đáp án hoặc lời giải trực tiếp cho các câu hỏi trong đề thi. " +
          "Bạn có thể hỏi về cách sử dụng hệ thống, cấu trúc đề hoặc nhờ gợi ý phương pháp làm bài.",
      });
    }

    // 2) Chặn câu hỏi ngoài phạm vi hệ thống
    if (isOutOfScope(message)) {
      return res.json({
        reply:
          "Mình chỉ hỗ trợ các vấn đề liên quan đến hệ thống luyện thi tiếng Anh THPT của bạn " +
          "(tài khoản, làm bài, xem kết quả, lỗi hệ thống, v.v.). " +
          "Câu hỏi hiện tại nằm ngoài phạm vi đó nên mình không thể trả lời.",
      });
    }

    // 3) Lấy metadata đề thi từ hệ thống (KHÔNG chứa đáp án)
    let systemContext = "";

    try {
      // --- Thống kê đề thường theo skill ---
      const skillStats = await Test.aggregate([
        {
          $group: {
            _id: "$skill",
            examCount: { $sum: 1 },
          },
        },
      ]);

      // --- Thống kê đề thường theo khối/lớp ---
      const gradeStats = await Test.aggregate([
        {
          $group: {
            _id: "$grade",
            examCount: { $sum: 1 },
          },
        },
      ]);

      const skillLines = skillStats
        .filter((s) => s._id)
        .map((s) => `- ${s._id}: ${s.examCount} đề`)
        .join("\n");

      const gradeLines = gradeStats
        .filter((g) => g._id)
        .map((g) => `- Khối ${g._id}: ${g.examCount} đề`)
        .join("\n");

      // --- Thống kê mock exam theo examType (thptqg, ielts, toeic,...) ---
      const mockTypeStats = await MockExam.aggregate([
        {
          $group: {
            _id: "$examType",
            examCount: { $sum: 1 },
          },
        },
      ]);

      const mockTypeLines = mockTypeStats
        .filter((m) => m._id)
        .map((m) => `- ${m._id}: ${m.examCount} đề thi thử`)
        .join("\n");

      // --- Một số đề thường mới nhất ---
      const latestExams = await Test.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select("title grade skill duration level")
        .lean();

      const latestTestLines = latestExams
        .map(
          (e) =>
            `• "${e.title}" – khối ${e.grade || "?"}, kỹ năng ${
              e.skill || "mixed"
            }, thời gian ${e.duration || 0} phút, độ khó ${e.level || "N/A"}`
        )
        .join("\n");

      // --- Một số mock exam mới nhất (bao gồm THPTQG 2025, v.v.) ---
      const latestMocks = await MockExam.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .select("name officialName examType grade year duration")
        .lean();

      const latestMockLines = latestMocks
        .map((m) => {
          const title = m.officialName || m.name || "Đề thi thử";
          return `• "${title}" – kỳ thi ${m.examType || "mock"}, năm ${
            m.year || "?"
          }, khối ${m.grade || "?"}, thời gian ${m.duration || 0} phút`;
        })
        .join("\n");

      systemContext =
        `Thống kê hệ thống (chỉ metadata, KHÔNG chứa đáp án):\n` +
        `- Đề thường theo kỹ năng:\n${skillLines || "- Chưa có dữ liệu"}\n\n` +
        `- Đề thường theo khối/lớp:\n${gradeLines || "- Chưa có dữ liệu"}\n\n` +
        `- Đề thi thử theo kỳ thi:\n${
          mockTypeLines || "- Chưa có mock exam nào"
        }\n\n` +
        `Một số đề thường mới nhất:\n${
          latestTestLines || "- Chưa có đề thường nào."
        }\n\n` +
        `Một số đề thi thử mới nhất:\n${
          latestMockLines || "- Chưa có đề thi thử nào."
        }`;
    } catch (metaErr) {
      console.error("Lỗi lấy metadata đề thi cho trợ lý:", metaErr);
      systemContext =
        "Không lấy được metadata đề thi, hãy trả lời chung chung dựa trên hướng dẫn sử dụng hệ thống.";
    }

    // 4) Gọi OpenAI với system prompt chặt chẽ + context đề thi
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "Bạn là trợ lý hỗ trợ kỹ thuật cho một hệ thống luyện thi tiếng Anh THPT quốc gia. " +
            "Chỉ được trả lời các câu hỏi liên quan đến: cách sử dụng hệ thống, đăng ký/đăng nhập, " +
            "cách làm bài, cấu trúc đề thi, ý nghĩa các màn hình, lỗi thường gặp và cách khắc phục. " +
            "Bạn KHÔNG được đưa ra đáp án cụ thể cho bất kỳ câu hỏi nào trong đề thi hoặc bài luyện tập. " +
            "Nếu người dùng cố xin đáp án hoặc hỏi nội dung không liên quan, hãy lịch sự từ chối " +
            "và nhắc lại rằng bạn chỉ hỗ trợ về hệ thống.\n\n" +
            "Dưới đây là metadata về các đề thi trong hệ thống (không chứa đáp án):\n" +
            systemContext,
        },
        {
          role: "user",
          content: message,
        },
      ],
    });

    const reply = completion.choices[0]?.message?.content?.trim();
    return res.json({
      reply:
        reply ||
        "Hiện tại mình chưa trả lời được câu hỏi này. Bạn có thể diễn đạt lại hoặc liên hệ giáo viên nhé.",
    });
  } catch (err) {
    console.error("Chat support error:", err);
    return res.status(500).json({
      reply: "Đã xảy ra lỗi khi xử lý yêu cầu, vui lòng thử lại sau.",
    });
  }
});

export default router;
