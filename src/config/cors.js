// src/config/cors.js
import cors from "cors";

export const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:5173",
  "https://nguyendautoan.github.io",
  "https://datn-ebon-eight.vercel.app",
];

// Hàm setup CORS, nhận app vào
export function setupCors(app) {
  // ÉP header CORS chuẩn cho mọi request HTTP
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    }

    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // Dùng thêm cors() cho chắc, KHÔNG dùng origin:"*"
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true, // nếu bạn cần gửi cookie/session; nếu chỉ dùng JWT qua header có thể bỏ
    })
  );
}
