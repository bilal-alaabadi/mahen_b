const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

// ---------- Middleware ----------
app.use(express.json({ limit: "25mb" }));
app.use(cookieParser());

// ضع كل الدومينات المسموح بها هنا
const allowedOrigins = [
  "https://www.mahindesignss.com",
  "https://mahindesignss.com",
  // للتطوير المحلي (اختياري):
  "http://localhost:5173",
  "http://localhost:3000",
];

const corsOptions = {
  origin: function (origin, callback) {
    // السماح لطلبات بدون Origin (Postman, curl, health checks)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  optionsSuccessStatus: 204, // لبعض المتصفحات القديمة
};

app.use(cors(corsOptions));

// حتى لا يُخزّن البروكسي/المتصفح هيدر ثابت لمنشأ واحد
app.use((req, res, next) => {
  res.header("Vary", "Origin");
  next();
});

// (اختياري) هاندلر واضح لأخطاء CORS
app.use((err, req, res, next) => {
  if (err && err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS: Origin not allowed", origin: req.headers.origin });
  }
  next(err);
});

// ---------- Routes & DB ----------
const authRoutes = require("./src/users/user.route");
const productRoutes = require("./src/products/products.route");
const reviewRoutes = require("./src/reviews/reviews.router");
const orderRoutes = require("./src/orders/orders.route");
const statsRoutes = require("./src/stats/stats.rout");

app.use("/api/auth", authRoutes);
app.use("/api/products", productRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/stats", statsRoutes);

async function main() {
  await mongoose.connect(process.env.DB_URL);
  console.log("MongoDB is successfully connected.");
}
main().catch(console.error);

app.get("/", (req, res) => {
  res.send("يعمل الان");
});

// --------- Start server ---------
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
