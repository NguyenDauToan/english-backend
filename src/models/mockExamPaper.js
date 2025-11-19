// models/mockExamPaper.js
import mongoose from "mongoose";

const answerKeySchema = new mongoose.Schema(
  {
    questionNumber: { type: Number, required: true },
    correctOption: {
      type: String,
      enum: ["A", "B", "C", "D"],
      required: true,
    },
  },
  { _id: false }
);

const mockExamPaperSchema = new mongoose.Schema(
  {
    mockExam: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MockExam",
      required: true,
    },

    year: { type: Number, required: true },
    officialName: { type: String, required: true },
    attempt: { type: Number, default: 1 },

    // file PDF/Word/Excel
    filePath: { type: String, required: true }, 
    fileType: {
      type: String,
      enum: ["pdf", "docx", "excel", "xlsx"], // thêm excel/xlsx
      default: "pdf",
    },

    // thi trắc nghiệm
    totalQuestions: { type: Number, default: 0 },
    answerKey: [answerKeySchema],

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model("MockExamPaper", mockExamPaperSchema);
