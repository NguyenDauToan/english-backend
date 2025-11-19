import express from "express";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/ai
router.post("/", verifyToken, verifyRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { grade, level, skill, type = "multiple_choice", amount = 5 } = req.body;
    if (!grade || !level || !skill) {
      return res.status(400).json({ message: "Thiếu thông tin grade, level hoặc skill" });
    }

    let questionTypeText = type === "multiple_choice" ? "trắc nghiệm" 
                        : type === "fill_blank" ? "điền vào chỗ trống" 
                        : "True/False";

    let prompt = "";
    if (type === "fill_blank") {
      prompt = `Hãy tạo ${amount} câu hỏi điền vào chỗ trống (fill-in-the-blank) tiếng Anh cho học sinh lớp ${grade}, cấp độ ${level}, kỹ năng ${skill}. 
Mỗi câu hỏi có dạng: We ___ (go) to the park yesterday.
Trả về JSON gồm:
- content: câu hỏi với chỗ trống và gợi ý trong ngoặc
- answer: đáp án đúng (từ bỏ trống)
- explanation: giải thích ngắn
Không tạo options.`;
    } else {
      prompt = `Hãy tạo ${amount} câu hỏi ${questionTypeText} tiếng Anh cho học sinh lớp ${grade}, cấp độ ${level}, kỹ năng ${skill}. 
Trả về JSON với mỗi câu hỏi có: content, options, answer, explanation.`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const content = completion.choices[0]?.message?.content?.trim() || "";
    let questions = [];
    try {
      const match = content.match(/\[.*\]/s);
      if (!match) throw new Error("Không tìm thấy JSON trong content");
      questions = JSON.parse(match[0]);
    } catch (e) {
      console.warn("Không parse được JSON từ OpenAI:", content);
      return res.status(200).json({ raw: content });
    }

    if (!questions.length) return res.status(400).json({ message: "AI không tạo được câu hỏi" });

    // 🔹 Format dữ liệu để frontend có thể save
    const formatted = questions.map(q => ({
      content: q.content || "Untitled Question",
      type,
      options: type === "multiple_choice" ? (Array.isArray(q.options) ? q.options : []) : [],
      answer: q.answer || "",
      explanation: q.explanation || "",
      skill,
      level,
      grade,
    }));

    res.status(200).json({ questions: formatted });
  } catch (err) {
    console.error("AI generate error:", err);
    res.status(500).json({ message: "Lỗi tạo câu hỏi AI" });
  }
});

export default router;
