import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import Test from "../models/test.js";

import SpeakingAttempt from "../models/speakingAttempt.js";
import Question from "../models/question.js";
import { verifyToken, verifyRole } from "../middleware/auth.js";

const router = express.Router();

/* ========= STORAGE ========== */
const speakingStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = "uploads/speaking";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext).replace(/\s+/g, "_");
    cb(null, `${base}-${Date.now()}${ext || ".webm"}`);
  },
});

const speakingUpload = multer({
  storage: speakingStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "audio/mpeg",
      "audio/mp3",
      "audio/wav",
      "audio/x-wav",
      "audio/webm",
    ];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Chỉ chấp nhận file audio mp3 / wav / webm"));
    }
    cb(null, true);
  },
});

/* ========= WHISPER LOCAL (clean JSON) ========== */
async function transcribeLocalWhisper(audioPath) {
  try {
    const output = execSync(
      `python python/transcribe_whisper.py "${audioPath}"`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "ignore"] }
    );

    const clean = output.trim();

    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]).transcript || "";

    return "";
  } catch (err) {
    console.error("Whisper local error:", err.message);
    return "";
  }
}

/* ========= OLLAMA LOCAL SCORING ========== */
// ===== CHẤM SPEAKING bằng OLLAMA LOCAL =====
// speakingAttempts.js

async function gradeWithOllama({ transcript, question }) {
  const maxPoints = question.maxPoints || 10;

  const referenceText =
    question.speakingSample ||
    question.answer ||
    question.content ||
    "";

  const instructions = `
You are an English speaking examiner.

QUESTION (what the student must answer or read aloud):
${question.content}

REFERENCE ANSWER / TEXT:
${referenceText || "No explicit sample provided"}

The student's spoken answer has ALREADY been transcribed for you:

STUDENT_TRANSCRIPT:
"""
${transcript}
"""

IMPORTANT:
- Do NOT rewrite or extend the transcript.
- Do NOT invent extra sentences.
- Just use this transcript for evaluation.

Evaluate the student's spoken answer using:
1. Relevance / coverage of the required content
2. Similarity to the reference text (if given)
3. Fluency, pronunciation, grammar, vocabulary, coherence

Return STRICT JSON ONLY, no extra text, no explanation outside JSON:

{
  "score": number (0 to ${maxPoints}),
  "level": "A1" | "A2" | "B1" | "B2" | "C1" | "C2",
  "keywordsUsed": ["keyword1", "keyword2"],
  "feedback": "short feedback (1–3 sentences)"
}
`.trim();

  const payload = {
    model: "llama3.2",
    prompt: instructions,
    stream: false,
    format: "json",
  };

  const res = await fetch("http://localhost:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  // data.response có thể là object hoặc string
  let text = typeof data.response === "string"
    ? data.response
    : JSON.stringify(data.response);

  text = text.trim();

  // LẤY ĐÚNG PHẦN JSON TRONG RESPONSE
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("Ollama response has no JSON:", text);
    return {
      transcript,  // luôn trả transcript từ Whisper
      score: null,
      level: null,
      keywordsUsed: [],
      feedback: "",
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const scoreRaw = parsed.score;
    const scoreNum =
      typeof scoreRaw === "number" ? scoreRaw : Number(scoreRaw ?? NaN);

    return {
      transcript, // KHÔNG dùng transcript của model
      score: Number.isFinite(scoreNum) ? scoreNum : null,
      level: parsed.level || null,
      keywordsUsed: Array.isArray(parsed.keywordsUsed)
        ? parsed.keywordsUsed
        : [],
      feedback: parsed.feedback || "",
    };
  } catch (e) {
    console.error("gradeWithOllama JSON.parse error:", e, "raw:", text);
    return {
      transcript,
      score: null,
      level: null,
      keywordsUsed: [],
      feedback: "",
    };
  }
}


/* ========= ROUTE ========== */
router.post(
  "/ai",
  verifyToken,
  verifyRole(["student"]),
  speakingUpload.single("audio"),
  async (req, res) => {
    try {
      const { questionId, examId, transcript } = req.body;

      if (!questionId) return res.status(400).json({ message: "Thiếu questionId" });
      if (!req.file) return res.status(400).json({ message: "Thiếu file audio" });

      const question = await Question.findById(questionId);
      if (!question) return res.status(400).json({ message: "Không tìm thấy câu hỏi" });

      if (question.skill !== "speaking")
        return res.status(400).json({ message: "Câu hỏi này không phải speaking" });

      const audioUrl = `/uploads/speaking/${req.file.filename}`;
      const audioPath = req.file.path;

      /* ============================
         STEP 1 — Tổng số câu Speaking của đề,
                  mỗi đề Speaking tối đa 10 điểm
      ============================ */
      let totalSpeakingQuestions = 0;
      let perQuestionPoint = 10; // mặc định nếu không có examId

      if (examId) {
        const exam = await Test.findById(examId).populate("questions");

        if (exam?.questions?.length) {
          totalSpeakingQuestions = exam.questions.filter(
            (q) => q && (q.skill === "speaking" || q.type === "speaking")
          ).length;

          if (totalSpeakingQuestions > 0) {
            // ví dụ 5 câu => 10 / 5 = 2 điểm/câu
            //        10 câu => 10 / 10 = 1 điểm/câu
            perQuestionPoint = 10 / totalSpeakingQuestions;
          }
        }
      }

      /* ============================
         STEP 2 — Whisper local
      ============================ */
      const transcriptLocal =
        transcript || (await transcribeLocalWhisper(audioPath));

      /* ============================
         STEP 3 — Chấm điểm bằng Ollama
      ============================ */
      const aiResultRaw = await gradeWithOllama({
        transcript: transcriptLocal,
        question,
      });
      // score gốc 0–10 do AI trả
      const score0_10 = aiResultRaw.score ?? 0;

      // chuẩn hóa về [0,1]
      const normalized = score0_10 / 10;

      // điểm của CÂU NÀY theo thang mỗi câu (2đ, 1đ,...)
      const scorePerQuestion = normalized * perQuestionPoint;
      const transcriptFinal = transcriptLocal || aiResultRaw.transcript || "";

      const aiResult = {
        ...aiResultRaw,
        transcript: transcriptFinal,   // ép transcript = Whisper
        score0_10,
        score: scorePerQuestion,
        maxScore: perQuestionPoint,
        totalSpeakingQuestions,
      };

      /* ============================
         STEP 4 — Lưu DB
      ============================ */
      const attempt = await SpeakingAttempt.create({
        question: questionId,
        student: req.user._id,
        exam: examId || undefined,
        audioUrl,
        transcript: transcriptFinal,   // lưu transcript Whisper
        score: scorePerQuestion,
        comment: aiResult.feedback,
        status: "graded",
        aiGraded: true,
        aiRawResult: aiResult,
      });

      return res.status(201).json({
        message: "Đã nộp và AI chấm speaking xong",
        attempt,
        aiResult,
      });
    } catch (err) {
      console.error("Lỗi /api/speaking-attempts/ai:", err);
      return res.status(500).json({ message: "Lỗi server khi chấm speaking" });
    }
  }
);


export default router;
