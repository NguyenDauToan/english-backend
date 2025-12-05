// models/classroom.js
import mongoose from "mongoose";

const { Schema } = mongoose;

const classroomSchema = new Schema(
  {
    name: { type: String, required: true }, // VD: "7A1"
    grade: { type: String },                // VD: "7", "10", "IELTS", ...

    // trường mà lớp này thuộc về
    school: {
      type: Schema.Types.ObjectId,
      ref: "School",
      required: true,
    },

    // giáo viên tiếng Anh phụ trách lớp
    homeroomTeacher: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    schoolYear: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SchoolYear",
      required: true,
    },
    // danh sách học sinh trong lớp
    students: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.models.Classroom || mongoose.model("Classroom", classroomSchema);
