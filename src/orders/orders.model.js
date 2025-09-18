// ========================= models/Order.js (نهائي) =========================
const mongoose = require("mongoose");

const GiftCardSchema = new mongoose.Schema(
  {
    from: { type: String, default: "" },
    to: { type: String, default: "" },
    phone: { type: String, default: "" },
    note: { type: String, default: "" },
  },
  { _id: false }
);

const MeasurementsSchema = new mongoose.Schema(
  {
    // تفصيل العبايات
    length: { type: String },
    sleeveLength: { type: String },
    width: { type: String },
    design: { type: String },
    color: { type: String },
    buttons: { type: String },
    // ملابس مناسبات
    chestFrontWidth: { type: String },
    sleeveFromShoulder: { type: String },
    shoulderWidth: { type: String },
    // عامة
    notes: { type: String },
  },
  { _id: false }
);

const OrderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },

    products: [
      {
        productId: { type: String, required: true },
        quantity: { type: Number, required: true },
        name: { type: String, required: true },
        price: { type: Number, required: true }, // سعر الوحدة بالعملة الأساسية (ر.ع.)
        image: { type: String },
        category: { type: String },
        measurements: { type: MeasurementsSchema, default: undefined },
        // ✅ بطاقة الهدية على مستوى كل منتج
        giftCard: { type: GiftCardSchema, default: undefined },
      },
    ],

    amount: { type: Number, required: true }, // المبلغ المدفوع فعلياً (ر.ع.)
    shippingFee: { type: Number, required: true, default: 2 }, // (ر.ع.)

    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    country: { type: String, required: true },
    wilayat: { type: String, required: true },
    description: { type: String },

    email: { type: String, default: "" },

    status: {
      type: String,
      required: true,
      enum: ["failed", "completed", "pending"],
      default: "pending",
    },

    currency: { type: String, required: true, enum: ["OMR", "AED"], default: "OMR" },

    // معلومات الدفع
    paymentSessionId: { type: String },
    paidAt: { type: Date },

    // ==== حقول المقدم/المتبقي ====
    depositMode: { type: Boolean, default: false },
    remainingAmount: { type: Number, default: 0 },

    // ==== بطاقة الهدية (على مستوى الطلب للتوافق) ====
    giftCard: { type: GiftCardSchema, default: undefined },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", OrderSchema);
module.exports = Order;
