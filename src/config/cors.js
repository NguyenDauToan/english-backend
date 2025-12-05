const allowedOrigins = [
  "http://localhost:8080",
  "http://localhost:5173",
  "https://nguyendautoan.github.io",
  "https://datn-ebon-eight.vercel.app/"
];

app.use(cors({
  origin: function(origin, callback) {
    console.log("CORS check, origin:", origin); // log debug
    if (!origin) return callback(null, true); // Postman / server-side
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // bắt buộc để gửi cookie/session
  methods: ["GET", "POST", "PUT", "DELETE"],
}));
