// src/models/question.js
import mongoose from "mongoose";

// sub-question cho dạng reading_cloze HOẶC listening_cloze
const readingSubQuestionSchema = new mongoose.Schema(
  {
    label: String,        // "Question 1", "Question 2", ...
    options: [String],    // ["A...", "B...", "C...", "D...]
    correctIndex: Number, // 0..3
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    content: { type: String, required: true },
    type: {
      type: String,
      enum: [
        "multiple_choice",
        "fill_blank",
        "true_false",
        "reading_cloze",
        // thêm các dạng Writing
        "writing_sentence_order", // sắp xếp câu
        "writing_paragraph",      // viết đoạn văn
        "writing_add_words",  
        "speaking",    // thêm từ còn thiếu
      ],
      required: true,
    },
    

    // dùng cho câu đơn
    options: [String],
    answer: { type: String },

    skill: {
      type: String,
      enum: ["listening", "reading", "writing", "speaking"],
      required: true,
    },

    level: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "easy",
    },

    grade: {
      type: String,
      enum: [
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "thptqg",
        "ielts",
        "toeic",
        "vstep",
      ],
    },

    // 🔹 Listening: lưu link audio tại đây (đã upload)
    audioUrl: { type: String },

    // dùng cho thptqg / ielts / toeic / vstep (1 đoạn văn / 1 file audio – nhiều blank)
    subQuestions: [readingSubQuestionSchema],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    explanation: String,
    tags: [String],
  },
  { timestamps: true }
);

questionSchema.index({ skill: 1, level: 1, grade: 1 });

export default mongoose.model("Question", questionSchema);
