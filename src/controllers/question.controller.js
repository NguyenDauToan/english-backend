import { openai } from "../utils/openai.js";

export const generateQuestion = async (req, res) => {
  try {
    const { grade, level, skill } = req.body;

    if (!grade || !level || !skill) {
      return res.status(400).json({ message: "Thiếu thông tin grade, level hoặc skill" });
    }

    const prompt = `
    Hãy tạo 5 câu hỏi trắc nghiệm tiếng Anh phù hợp cho học sinh lớp ${grade}, 
    cấp độ ${level} (Beginner, Intermediate, Advanced),
    tập trung vào kỹ năng ${skill} (Listening, Reading, Writing hoặc Speaking).
    Trả về kết quả dưới dạng JSON chuẩn, ví dụ:
    [
      { "question": "What does the boy like?", "options": ["A. Swimming", "B. Reading", "C. Dancing", "D. Cooking"], "answer": "B" }
    ]
    `;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
    });

    const content = completion.choices[0].message?.content || "";
    let questions = [];

    try {
      questions = JSON.parse(content);
    } catch (e) {
      console.warn("Không parse được JSON, trả về dạng text:", content);
      return res.json({ success: true, raw: content });
    }

    res.json({ success: true, questions });
  } catch (error) {
    console.error("Lỗi khi tạo câu hỏi:", error.message);
    res.status(500).json({ message: "Lỗi khi tạo câu hỏi AI" });
  }
};
