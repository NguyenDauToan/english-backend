// src/routes/ai.js
import express from "express";
import { verifyToken, verifyRole } from "../middleware/auth.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

// nếu muốn cấu hình khác localhost thì đặt OLLAMA_URL trong .env
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";

/**
 * Gọi Ollama generate (model local, ví dụ llama3.2)
 * trả về string content (toàn bộ text model trả)
 */
async function callOllama(prompt) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama3.2",   // hoặc model khác bạn đã pull: mistral, qwen2.5, ...
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama error: ${res.status} ${text}`);
  }

  const data = await res.json();
  const raw = typeof data.response === "string"
    ? data.response
    : JSON.stringify(data.response);

  return raw.trim();
}

// POST /api/ai
router.post(
  "/",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager"]),
  async (req, res) => {
    try {
      const {
        grade,
        level,
        skill,
        type = "multiple_choice",
        amount = 5,
      } = req.body;

      if (!grade || !level || !skill) {
        return res
          .status(400)
          .json({ message: "Thiếu thông tin grade, level hoặc skill" });
      }

      let prompt = "";

      // ====== 1. Fill in the blank ======
      if (type === "fill_blank") {
        prompt = `Hãy tạo ${amount} câu hỏi điền vào chỗ trống (fill-in-the-blank) tiếng Anh cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}, kỹ năng ${skill}.
  Mỗi câu hỏi có dạng: We ___ (go) to the park yesterday.
  Yêu cầu:
  - Mỗi câu hỏi chỉ có 1 chỗ trống.
  - Nội dung phù hợp trình độ tương ứng, ngữ pháp/vocabulary rõ ràng.

  Trả về DUY NHẤT một JSON là một mảng, ví dụ:
  [
    {
      "content": "We ___ (go) to the park yesterday.",
      "answer": "went",
      "explanation": "Quá khứ đơn của 'go' là 'went'."
    }
  ]

  Quy định:
  - content: câu hỏi có chỗ trống và có gợi ý dạng động từ nguyên thể hoặc từ trong ngoặc.
  - answer: từ cần điền đúng (không kèm ngoặc).
  - explanation: giải thích ngắn gọn bằng tiếng Việt hoặc Anh.
  Không tạo options. Không giải thích thừa ngoài JSON.`;
      }

      // ====== 2. Writing – sắp xếp câu ======
      else if (type === "writing_sentence_order") {
        prompt = `Hãy tạo ${amount} câu bài tập Writing dạng SẮP XẾP CÂU (writing sentence order) tiếng Anh cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}.
  Mỗi câu gồm:
  - Một câu tiếng Anh HOÀN CHỈNH (answer).
  - Một phiên bản bị xáo trộn trật tự từ hoặc cụm từ (content), dùng để HS kéo thả lại.

  YÊU CẦU RẤT RÕ:
  - KHÔNG được tạo bài tập dạng thêm từ còn thiếu, KHÔNG có dấu "___", "____", dấu gạch dưới, hoặc ngoặc gợi ý.
  - "content" PHẢI là danh sách từ/cụm từ đã xáo trộn, phân tách bằng dấu "/" (ví dụ: "plays / soccer / every / Tom / weekend / his / friend").
  - "answer" PHẢI là câu hoàn chỉnh đúng, viết hoa chuẩn, có dấu chấm cuối câu nếu cần.
  - "explanation" là giải thích ngắn, có thể ghi cấu trúc: "Chủ ngữ + động từ + tân ngữ + trạng từ chỉ thời gian."

  Trả về DUY NHẤT một JSON là một mảng, ví dụ:
  [
    {
      "content": "plays / soccer / every / Tom / weekend / his / friend",
      "answer": "Tom plays soccer with his friend every weekend.",
      "explanation": "Cấu trúc: Chủ ngữ + động từ + tân ngữ + trạng từ chỉ thời gian."
    }
  ]

  Quy định:
  - content: câu bị xáo trộn (các từ/cụm từ ngăn cách bởi dấu "/"), KHÔNG có chỗ trống cần điền, KHÔNG yêu cầu "thêm từ".
  - answer: câu hoàn chỉnh đúng.
  - explanation: giải thích ngắn (có thể ghi chú cấu trúc ngữ pháp).
  Không trả về options. Không ghi thêm text ngoài JSON.`;
      }

      // ====== 3. Writing – thêm từ còn thiếu ======
      else if (type === "writing_add_words") {
        prompt = `Hãy tạo ${amount} câu bài tập Writing dạng thêm từ còn thiếu (writing add words) tiếng Anh cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}.
  Mỗi bài:
  - Đưa ra câu chưa hoàn chỉnh hoặc thiếu 1–2 từ.
  - Yêu cầu học sinh viết lại câu đúng, thêm từ còn thiếu.

  Trả về DUY NHẤT một JSON là một mảng, ví dụ:
  [
    {
      "content": "She _____ going to school now. (thêm be-verb thích hợp)",
      "answer": "She is going to school now.",
      "explanation": "Hiện tại tiếp diễn: S + be + V-ing."
    }
  ]

  Quy định:
  - content: câu yêu cầu, có mô tả hoặc hướng dẫn chỗ cần thêm từ.
  - answer: câu đầy đủ đúng.
  - explanation: giải thích ngắn về ngữ pháp/từ vựng.
  Không trả về options. Không ghi thêm text ngoài JSON.`;
      }

      // ====== 4. Writing – viết đoạn văn ======
      else if (type === "writing_paragraph") {
        prompt = `Hãy tạo ${amount} đề bài Writing dạng viết đoạn văn (writing paragraph) tiếng Anh cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}.
  Mỗi đề bài yêu cầu viết đoạn văn khoảng 80–120 từ (có thể ghi rõ số từ) về một chủ đề quen thuộc.

  Trả về DUY NHẤT một JSON là một mảng, ví dụ:
  [
    {
      "content": "Write a paragraph (80-100 words) about your favorite hobby. Describe what it is, how often you do it, and why you like it.",
      "answer": "Sample paragraph: ...",
      "explanation": "Gợi ý cấu trúc đoạn văn: câu chủ đề, 2-3 câu triển khai, câu kết."
    }
  ]

  Quy định:
  - content: đề bài yêu cầu viết đoạn văn, ghi rõ số từ gợi ý.
  - answer: một đoạn văn mẫu (sample answer) phù hợp trình độ để giáo viên tham khảo.
  - explanation: gợi ý ngắn về cấu trúc hoặc ý chính.
  Không trả về options. Không ghi thêm text ngoài JSON.`;
      }

      // ====== 5. Speaking ======
      else if (type === "speaking" || skill === "speaking") {
        prompt = `Hãy tạo ${amount} bài SPEAKING dạng ĐỌC ĐOẠN VĂN TIẾNG ANH cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}.
        Mục tiêu: học sinh ĐỌC TO một đoạn văn ngắn để luyện phát âm, ngữ điệu, độ trôi chảy.
        
        YÊU CẦU:
        - Mỗi phần tử trong mảng JSON là 1 task speaking độc lập.
        - Mỗi task gồm MỘT ĐOẠN VĂN NGẮN (khoảng 3–6 câu, độ dài ~50–120 từ) về một chủ đề quen thuộc (school, family, hobbies, daily routine, weekend, holiday, technology, environment,... tuỳ level).
        - Ngôn ngữ, từ vựng và ngữ pháp phù hợp trình độ "${grade}", level ${level}, không quá khó.
        - Đoạn văn phải liền mạch, đầy đủ câu, không phải dạng bullet list.
        
        TRẢ VỀ DUY NHẤT một JSON LÀ MỘT MẢNG, ví dụ:
        
        [
          {
            "content": "Read the following paragraph aloud:\\n\\nLast weekend, I went to the countryside with my family. We visited my grandparents and helped them in the garden. In the evening, we had a big dinner together and told many funny stories.",
            "answer": "Last weekend, I went to the countryside with my family. We visited my grandparents and helped them in the garden. In the evening, we had a big dinner together and told many funny stories.",
            "explanation": "Đoạn văn ngắn về chuyến đi cuối tuần, dùng thì quá khứ đơn, phù hợp trình độ trung học cơ sở."
          }
        ]
        
        QUY ĐỊNH BẮT BUỘC:
        - content: CHÍNH LÀ đề bài hiển thị cho học sinh, phải bao gồm hướng dẫn đọc + đoạn văn. Gợi ý format:
          "Read the following paragraph aloud:\\n\\n<đoạn văn tiếng Anh 3–6 câu>"
        - answer: CHỈ chứa nguyên văn đoạn văn tiếng Anh (không kèm câu hướng dẫn), dùng làm đoạn chuẩn để hệ thống so sánh khi chấm SPEAKING.
        - explanation: giải thích rất ngắn về chủ đề hoặc cấu trúc ngữ pháp chính (bằng tiếng Việt hoặc tiếng Anh).
        
        Không trả về options. Không ghi thêm bất kỳ text nào ngoài JSON mảng.`;
      }


      // ====== 6. Các dạng trắc nghiệm & True/False còn lại ======
      else {
        let questionTypeText =
          type === "multiple_choice"
            ? "trắc nghiệm nhiều lựa chọn (4 đáp án A, B, C, D)"
            : type === "true_false"
              ? "True/False"
              : "trắc nghiệm";

        if (type === "multiple_choice") {
          // multiple_choice: CẤM True/False, bắt buộc có answer và answer thuộc options
          prompt = `Hãy tạo ${amount} câu hỏi trắc nghiệm nhiều lựa chọn (4 đáp án A, B, C, D) tiếng Anh cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}, kỹ năng ${skill}.
        Yêu cầu:
        - Mỗi câu có đúng 4 đáp án lựa chọn, nội dung là câu trả lời đầy đủ, KHÔNG phải dạng "True/False", "Yes/No".
        - KHÔNG được dùng các đáp án "True", "False", "Yes", "No" làm toàn bộ nội dung đáp án.
        - Nội dung và từ vựng phù hợp trình độ.
        - Mỗi câu CHỈ có 1 đáp án đúng.
        - Trường "answer" PHẢI trùng khớp đúng với một trong 4 phần tử trong "options".
        
        Trả về DUY NHẤT một JSON là một mảng, ví dụ:
        [
          {
            "content": "What time do you usually get up?",
            "options": [
              "At seven o'clock.",
              "In the evening.",
              "At school.",
              "Very well."
            ],
            "answer": "At seven o'clock.",
            "explanation": "Đáp án phù hợp câu hỏi về thời gian."
          }
        ]
        
        Quy định:
        - content: câu hỏi tiếng Anh.
        - options: MẢNG 4 đáp án, mỗi phần tử là một chuỗi, KHÔNG được là "True" hoặc "False".
        - answer: một chuỗi, BẮT BUỘC phải trùng với một phần tử trong "options".
        - explanation: giải thích ngắn.
        KHÔNG ghi thêm bất kỳ chữ nào ngoài JSON mảng.`;
        } else {
          // true_false và các loại khác giữ nguyên logic cũ
          prompt = `Hãy tạo ${amount} câu hỏi ${questionTypeText} tiếng Anh cho học sinh/thí sinh trình độ lớp hoặc kỳ thi "${grade}", cấp độ ${level}, kỹ năng ${skill}.
        Yêu cầu:
        - Nội dung và từ vựng phù hợp trình độ.
        - Nếu là True/False thì answer chỉ là "True" hoặc "False".
        
        Trả về DUY NHẤT một JSON là một mảng, ví dụ:
        [
          {
            "content": "Students should do homework every day.",
            "answer": "True",
            "explanation": "Câu khẳng định chung về việc học tập."
          }
        ]
        
        Quy định:
        - content: câu hỏi tiếng Anh.
        - answer: đáp án đúng.
        - explanation: giải thích ngắn.
        Không ghi thêm text ngoài JSON.`;
        }
      }


      // ==== Gọi Ollama thay cho OpenAI ====
      const content = await callOllama(prompt);

      let questions = [];

      try {
        // Ưu tiên lấy JSON nằm trong ```json ... ```
        let jsonText = null;

        const fenceMatch =
          content.match(/```json([\s\S]*?)```/i) ||
          content.match(/```([\s\S]*?)```/i);

        if (fenceMatch) {
          jsonText = fenceMatch[1].trim();
        } else {
          // fallback: lấy từ dấu [ đầu tiên đến dấu ] cuối cùng
          const first = content.indexOf("[");
          const last = content.lastIndexOf("]");
          if (first !== -1 && last !== -1 && last > first) {
            jsonText = content.slice(first, last + 1);
          }
        }

        if (!jsonText) {
          console.warn("Không tìm thấy mảng JSON trong content:", content);
          return res.status(200).json({ raw: content });
        }

        let parsed;
        try {
          parsed = JSON.parse(jsonText);
        } catch (e) {
          console.error("Parse JSON từ Ollama thất bại:", e, jsonText);
          // gửi raw về FE để bạn debug nếu cần
          return res.status(200).json({ raw: content });
        }

        if (Array.isArray(parsed)) {
          questions = parsed;
        } else if (parsed && typeof parsed === "object") {
          questions = [parsed];
        }

      } catch (e) {
        console.warn("Không parse được JSON từ Ollama:", e, content);
        return res.status(200).json({ raw: content });
      }

      if (!questions.length) {
        return res.status(400).json({ message: "AI không tạo được câu hỏi" });
      }

      // Chuẩn hoá dữ liệu để FE lưu
      let formatted = questions.map((q) => {
        let content = q.content || "Untitled Question";
        const answer = (q.answer || "").trim();
        const explanation = q.explanation || "";

        // --- Chuẩn hoá options ---
        let rawOptions = q.options;

        // Nếu model trả options là TEXT (nhiều dòng / bullet) → tách thành mảng
        if (
          type === "multiple_choice" &&
          !Array.isArray(rawOptions) &&
          typeof rawOptions === "string"
        ) {
          rawOptions = rawOptions
            .split(/\r?\n|•|-|\*/g) // xuống dòng / bullet / dấu gạch
            .map((s) =>
              s
                .trim()
                // bỏ prefix A. / B) ...
                .replace(/^[A-D][\.\)]\s*/i, "")
            )
            .filter(Boolean);
        }

        const options =
          type === "multiple_choice" && Array.isArray(rawOptions)
            ? rawOptions
            : [];

        // Nếu là writing_sentence_order thì tự xáo trộn từ từ answer
        if (type === "writing_sentence_order") {
          const baseSentence =
            typeof answer === "string" && answer.trim() ? answer : content;

          let tokens = baseSentence
            .replace(/[.,!?;:]/g, "")
            .split(/\s+/)
            .map((t) => t.trim())
            .filter(Boolean);

          // shuffle Fisher–Yates
          for (let i = tokens.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [tokens[i], tokens[j]] = [tokens[j], tokens[i]];
          }

          content = tokens.join(" / ");
        }

        return {
          content,
          type,
          options,
          answer,
          explanation,
          skill,
          level,
          grade,
        };
      });

      // 🚩 Lọc lại cho multiple_choice: phải đủ options + answer hợp lệ
      if (type === "multiple_choice") {
        formatted = formatted.filter((q) => {
          if (!q.options || q.options.length < 3) return false; // ít nhất 3–4 đáp án
          if (!q.answer) return false;
          // answer phải khớp 1 trong các options
          return q.options.some(
            (opt) => opt.trim().toLowerCase() === q.answer.trim().toLowerCase()
          );
        });
      }

      if (!formatted.length) {
        return res.status(400).json({
          message:
            "AI tạo câu hỏi nhưng không câu nào đủ dữ liệu hợp lệ (options/answer).",
        });
      }

      res.status(200).json({ questions: formatted });
    } catch (err) {
      console.error("AI generate error:", err);
      res.status(500).json({ message: "Lỗi tạo câu hỏi AI (Ollama)" });
    }
  }
);
// Thử bóc tách điểm từ output dạng markdown, không phải JSON
function parseMarkdownEvaluation(text, studentText) {
  // Helper lấy số từ regex
  const getScore = (regex) => {
    const m = text.match(regex);
    if (!m) return null;
    const numStr = m[1].replace(",", ".").trim();
    const val = parseFloat(numStr);
    return Number.isFinite(val) ? val : null;
  };

  const taskScore = getScore(/\*\*Task response[^\n]*\*\*:?\s*([\d.,]+)/i);
  const coherenceScore = getScore(/Coherence\s*&\s*cohesion[^\n]*:?\s*([\d.,]+)/i);
  const vocabScore = getScore(/Vocabulary[^\n]*:?\s*([\d.,]+)/i);
  const grammarScore = getScore(/Grammar\s*&\s*accuracy[^\n]*:?\s*([\d.,]+)/i);
  const overallScore =
    getScore(/\*\*Tổng điểm\*\*:?\s*([\d.,]+)/i) ||
    getScore(/\*\*OverallScore\*\*:?\s*([\d.,]+)/i);

  // Đoạn văn đã chỉnh sửa nằm giữa 3 dấu ngoặc kép """ ... """
  let correctedText = "";
  const correctedMatch = text.match(/"""\s*([\s\S]*?)\s*"""/);
  if (correctedMatch) {
    correctedText = correctedMatch[1].trim();
  }

  // Gợi ý: các dòng bắt đầu bằng "1.", "2.", ...
  const suggestions = text
    .split("\n")
    .filter((line) => /^\s*\d+\.\s+/.test(line))
    .map((line) => line.replace(/^\s*\d+\.\s+/, "").trim())
    .filter(Boolean);

  // Ước lượng số từ
  const baseText = correctedText || studentText || "";
  const wordCount = baseText
    .split(/\s+/)
    .filter((w) => w.trim().length > 0).length;

  // Nếu không có overallScore thì coi như thất bại
  if (overallScore == null) return null;

  return {
    overallScore,
    level: null,
    wordCount,
    criteria: {
      taskResponse: {
        score: taskScore,
        comment: "",
      },
      coherence: {
        score: coherenceScore,
        comment: "",
      },
      vocabulary: {
        score: vocabScore,
        comment: "",
      },
      grammar: {
        score: grammarScore,
        comment: "",
      },
    },
    correctedText,
    suggestions,
  };
}

// POST /api/ai/writing-eval
// Chấm bài viết đoạn văn (writing_paragraph)

router.post(
  "/writing-eval",
  verifyToken,
  verifyRole(["teacher", "admin", "school_manager", "student"]), // tuỳ bạn giới hạn
  async (req, res) => {
    try {
      const {
        grade,
        level,
        question,      // đề bài: nội dung yêu cầu viết đoạn văn
        studentText,   // đoạn văn học sinh đã viết
        expectedWords, // optional: số từ mong muốn (vd 80-120)
      } = req.body;

      if (!studentText || !studentText.trim()) {
        return res
          .status(400)
          .json({ message: "Thiếu đoạn văn của học sinh (studentText)" });
      }

      const safeGrade = grade || "general";
      const safeLevel = level || "B1";

      const prompt = `
      Bạn là giáo viên tiếng Anh, chấm bài viết đoạn văn của học sinh phổ thông Việt Nam.
      
      Thông tin:
      - Lớp/kỳ thi (grade): "${safeGrade}"
      - Cấp độ (level): "${safeLevel}"
      - Đề bài (question): ${question ? `"${question}"` : "(không cung cấp)"}
      - Đoạn văn học sinh viết (studentText):
      
      """
      ${studentText}
      """
      
      ${expectedWords
          ? `Độ dài mong muốn khoảng ${expectedWords} từ.`
          : "Độ dài đoạn văn khoảng 80–120 từ là phù hợp."
        }
  Hãy ĐÁNH GIÁ đoạn văn theo các tiêu chí sau:
1) Task response (hoàn thành yêu cầu đề bài, đủ ý, đúng chủ đề)
2) Coherence & cohesion (mạch lạc, logic, liên kết câu/ý)
3) Vocabulary (từ vựng phù hợp, đa dạng, ít lặp)
4) Grammar & accuracy (ngữ pháp, chính tả, dấu câu)

YÊU CẦU BẮT BUỘC:
- Tất cả phần nhận xét, mô tả, comment và suggestions phải viết BẰNG TIẾNG VIỆT.
- Trường "correctedText" PHẢI LÀ ĐOẠN VĂN TIẾNG ANH đã được chỉnh sửa, không chứa tiếng Việt hay bất kỳ ngôn ngữ nào khác.
- Không được viết kiểu "Đoạn văn đã được giáo viên chỉnh sửa..." trong "correctedText". "correctedText" phải bắt đầu trực tiếp bằng câu tiếng Anh của đoạn văn.
- Cho điểm từng tiêu chí theo thang 0–10 (có thể số thập phân, ví dụ 6.5).
- Cho điểm tổng (overallScore) 0–10.
- Ước lượng số từ (wordCount).
- Đưa ra 3–6 gợi ý cải thiện cụ thể (suggestions) bằng TIẾNG VIỆT.

TRẢ VỀ DUY NHẤT MỘT JSON OBJECT, KHÔNG THÊM BẤT KỲ TEXT NÀO KHÁC, ví dụ:

{
  "overallScore": 7.5,
  "level": "B1 (Intermediate)",
  "wordCount": 95,
  "criteria": {
    "taskResponse": {
      "score": 7.5,
      "comment": "Đoạn văn trả lời đúng chủ đề, có đủ 2–3 ý chính, nhưng phần kết còn hơi ngắn."
    },
    "coherence": {
      "score": 7.0,
      "comment": "Các câu khá mạch lạc, có sử dụng một số từ nối cơ bản."
    },
    "vocabulary": {
      "score": 7.0,
      "comment": "Từ vựng phù hợp trình độ, nên thêm vài từ mô tả chi tiết hơn."
    },
    "grammar": {
      "score": 6.5,
      "comment": "Một số lỗi thì hiện tại đơn/quá khứ đơn và thiếu mạo từ."
    }
  },
  "correctedText": "Every day, I follow a simple routine that helps me stay organized and focused. In the morning, I get up early to prepare for school and review my lessons...",
  "suggestions": [
    "Thêm 1–2 câu kết luận để đoạn văn trọn ý hơn.",
    "Dùng thêm từ nối như 'however', 'therefore' để tăng tính liên kết.",
    "Kiểm tra lại thì của động từ khi kể về thói quen hiện tại."
  ]
}
`;

      // Gọi Ollama
      const content = await callOllama(prompt);

      let jsonText = null;
      const fenceMatch =
        content.match(/```json([\s\S]*?)```/i) ||
        content.match(/```([\s\S]*?)```/i);

      if (fenceMatch) {
        jsonText = fenceMatch[1].trim();
      } else {
        const first = content.indexOf("{");
        const last = content.lastIndexOf("}");
        if (first !== -1 && last !== -1 && last > first) {
          jsonText = content.slice(first, last + 1);
        }
      }

      // ❶ Không tìm thấy JSON → thử fallback sang parser markdown
      if (!jsonText) {
        console.warn("Không tìm thấy JSON eval trong content:", content);

        const fallbackEval = parseMarkdownEvaluation(content, studentText);
        if (fallbackEval) {
          return res.status(200).json({ evaluation: fallbackEval, raw: content });
        }

        return res.status(200).json({ raw: content });
      }

      // ❷ “Lau chùi” JSON để tránh lỗi parse
      jsonText = jsonText
        // bỏ các escape Unicode lạ (IPA, v.v.)
        .replace(/\\u[0-9a-fA-F]{4}/g, "")
        // gộp "" thành " (tránh ..., vì,..."" )
        .replace(/""/g, '"')
        // bỏ dấu phẩy thừa trước } hoặc ]
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]");

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch (e) {
        console.error("Parse JSON eval thất bại:", e, jsonText);

        // ❸ JSON vẫn lỗi → fallback sang parser markdown
        const fallbackEval = parseMarkdownEvaluation(content, studentText);
        if (fallbackEval) {
          return res.status(200).json({ evaluation: fallbackEval, raw: content });
        }

        return res
          .status(200)
          .json({ raw: content, error: "JSON_EVAL_PARSE_FAILED" });
      }

      // Cho phép model lỡ trả về mảng -> lấy phần tử đầu
      const evaluation = Array.isArray(parsed) ? parsed[0] : parsed;

      if (!evaluation || typeof evaluation !== "object") {
        return res
          .status(400)
          .json({ message: "AI không trả về dữ liệu chấm điểm hợp lệ" });
      }

      return res.status(200).json({ evaluation });
    } catch (err) {
      console.error("AI writing-eval error:", err);
      return res
        .status(500)
        .json({ message: "Lỗi chấm điểm bài viết Writing (Ollama)" });
    }
  }
);

export default router;
