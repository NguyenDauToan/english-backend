import cors from "cors";

const allowedOrigins = [
  "http://localhost:5173",  // React dev
  "http://localhost:8080",  // Nếu frontend chạy cổng khác
  "https://english-backend-uoic.onrender.com" // Production frontend
];

const corsOptions = {
  origin: function(origin, callback){
    if(!origin) return callback(null, true); // cho Postman hoặc server-side request
    if(allowedOrigins.indexOf(origin) !== -1){
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true, // để gửi cookie/session
  methods: ["GET", "POST", "PUT", "DELETE"]
};

app.use(cors(corsOptions));
