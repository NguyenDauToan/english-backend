// ===== CORS CONFIG =====
const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:5173",
  "https://nguyendautoan.github.io",
  "https://datn-ebon-eight.vercel.app",
];

// ÉP header CORS chuẩn cho mọi request HTTP
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Credentials", "true");
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

// Dùng thêm cors() cho chắc, nhưng KHÔNG dùng origin:"*"
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
// ===== END CORS CONFIG =====
