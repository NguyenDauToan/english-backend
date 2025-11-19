// src/config/mockExamUpload.js
import multer from "multer";
import fs from "fs";
import path from "path";

// Thư mục lưu file: /uploads/mock-exams
const uploadDir = path.join(process.cwd(), "uploads", "mock-exams");

// Tạo thư mục nếu chưa có
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Cấu hình nơi lưu + tên file
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname); // .pdf / .docx / .xlsx ...
    const base = path.basename(file.originalname, ext);
    const safeBase = base.replace(/[^a-zA-Z0-9-_]/g, "_"); // tránh ký tự lạ
    const unique = Date.now();
    cb(null, `${safeBase}-${unique}${ext}`);
  },
});

// Cho phép các loại file: pdf, doc, docx, xlsx, xls
const allowedExt = [".pdf", ".doc", ".docx", ".xlsx", ".xls"];

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowedExt.includes(ext)) {
    return cb(
      new Error("Chỉ cho phép file pdf/doc/docx/xlsx/xls cho đề thi"),
      false
    );
  }
  cb(null, true);
}

// Multer upload instance dùng chung cho mock-exam (PDF/Word/Excel)
const mockExamUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB
  },
});

export { mockExamUpload };
