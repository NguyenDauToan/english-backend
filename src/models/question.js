import mongoose from "mongoose";

// sub-question cho dạng reading_cloze
const readingSubQuestionSchema = new mongoose.Schema(
  {
    label: String,          // "Question 1", "Question 2", ...
    options: [String],      // ["A...", "B...", "C...", "D...]
    correctIndex: Number,   // 0..3
  },
  { _id: false }
);

const questionSchema = new mongoose.Schema(
  {
    content: { type: String, required: true },

    // thêm reading_cloze
    type: {
      type: String,
      enum: ["multiple_choice", "fill_blank", "true_false", "reading_cloze"],
      required: true,
    },

    // dùng cho câu đơn
    options: [String],

    // KHÔNG required nữa vì reading_cloze không có 1 answer duy nhất
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

    // dùng cho thptqg / ielts / toeic / vstep (1 đoạn văn – nhiều blank)
    subQuestions: [readingSubQuestionSchema],

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    explanation: String,
      tags: [String],
    },
  { timestamps: true }
);

// index để filter nhanh theo skill, level, grade
questionSchema.index({ skill: 1, level: 1, grade: 1 });

export default mongoose.model("Question", questionSchema);
