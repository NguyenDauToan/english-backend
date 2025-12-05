// src/utils/mailer.js
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // nếu dùng 465 thì để true
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendNewExamEmail({
  to,
  studentName,
  examTitle,
  duration,
  examLink,
}) {
  const html = `
    <p>Chào ${studentName || "bạn"},</p>
    <p>Hệ thống vừa thêm một bài thi mới:</p>
    <ul>
      <li><strong>Đề thi:</strong> ${examTitle}</li>
      <li><strong>Thời gian làm bài:</strong> ${duration || 0} phút</li>
    </ul>
    <p>Bạn có thể vào làm bài thi tại đây:</p>
    <p>
      <a href="${examLink}" target="_blank"
         style="
           display:inline-block;
           padding:8px 16px;
           background:#4f46e5;
           color:#ffffff;
           text-decoration:none;
           border-radius:4px;
         ">
        Làm bài thi ngay
      </a>
    </p>
    <p>Hoặc copy đường link sau và dán vào trình duyệt:<br/>
      <span style="color:#555;">${examLink}</span>
    </p>
  `;

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: `Bài thi mới: ${examTitle}`,
    html,
  });
}
