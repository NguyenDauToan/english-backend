import mongoose, { Schema } from "mongoose";

const mockExamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    examType: {
      type: String,
      enum: ["thptqg", "ielts", "toeic", "vstep", "other"],
      required: true,
    },
    description: { type: String, default: "" },
    duration: { type: Number, required: true },

    level: {
      type: String,
      enum: ["easy", "medium", "hard", "mixed"],
      default: "mixed",
    },
    grade: { type: String }, // hiển thị: "Lớp 6", "thptqg"...
    skill: { type: String, default: "mixed" },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    archivedAt: {
      type: Date,
    },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    year: Number,
    officialName: String,
    tags: [String],
    isActive: { type: Boolean, default: true },
    totalQuestions: { type: Number, default: 0 },

    schoolYear: { type: mongoose.Schema.Types.ObjectId, ref: "SchoolYear" },

    slug: {
      type: String,
      unique: true,
      sparse: true,
    },

    // ⬇️ THÊM 2 FIELD THỜI GIAN DIỄN RA
    startTime: { type: Date },  // thời gian bắt đầu làm bài
    endTime: { type: Date },    // (tuỳ chọn) thời gian kết thúc / đóng đề

    // chỉ lưu id câu hỏi từ bảng Question
    questions: [
      {
        type: Schema.Types.ObjectId,
        ref: "Question",
      },
    ],

    // PHẠM VI ÁP DỤNG ĐỀ
    scope: {
      type: String,
      enum: ["class", "grade"], // "class" = 1 lớp, "grade" = cả khối
      default: "class",
    },

    // nếu scope = "grade": áp dụng cho cả khối trong 1 trường
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
    },
    gradeKey: {
      type: String, // "6","7","8","9","10","11","12", ...
    },

    // nếu scope = "class": áp dụng cho 1 lớp cụ thể
    classroom: {
      type: Schema.Types.ObjectId,
      ref: "Classroom",
    },

    // người tạo đề
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },

    // thông tin duyệt
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    rejectReason: { type: String, default: "" },
  },
  { timestamps: true }
);

// (tuỳ chọn) index để query upcoming nhanh hơn
mockExamSchema.index({ startTime: 1 });

export default mongoose.model("MockExam", mockExamSchema);
