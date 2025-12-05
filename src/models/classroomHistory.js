// src/models/classroomHistory.js
import mongoose from "mongoose";

const classroomHistorySchema = new mongoose.Schema(
  {
    // Tên lớp tại thời điểm chốt năm học
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Khối lớp (6,7,8,..., IELTS, TOEIC,...)
    grade: {
      type: String,
      trim: true,
    },

    // Trường
    school: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },

    // Năm học mà lịch sử này thuộc về
    schoolYear: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: true,
    },

    // GV tiếng Anh (nếu có) tại thời điểm đó
    homeroomTeacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Danh sách HS của lớp ở năm đó
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Tham chiếu đến document Classroom gốc (năm đó)
    originalClassroom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Classroom",
      required: true,
    },
  },
  {
    timestamps: true, // createdAt = thời điểm chốt/ghi lịch sử
  }
);

const ClassroomHistory = mongoose.model(
  "ClassroomHistory",
  classroomHistorySchema
);

export default ClassroomHistory;
