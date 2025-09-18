// ========================= routes/orders.js =========================
const express = require("express");
const cors = require("cors");
const Order = require("./orders.model");
const verifyToken = require("../middleware/verifyToken");
const verifyAdmin = require("../middleware/verifyAdmin");
const router = express.Router();
const axios = require("axios");
require("dotenv").config();

// مفاتيح من .env
const THAWANI_API_KEY = process.env.THAWANI_API_KEY;
const THAWANI_API_URL = process.env.THAWANI_API_URL;
const publish_key = process.env.THAWANI_PUBLISH_KEY;

// ✅ Cache مشترك على مستوى التطبيق
if (!global.ORDER_CACHE) {
  global.ORDER_CACHE = new Map();
}
const ORDER_CACHE = global.ORDER_CACHE;

// تحويل ر.ع. إلى بيسة
const toBaisa = (omr) => {
  const val = Math.round(Number(omr || 0) * 1000);
  return val < 100 ? 100 : val;
};

// ✅ Helpers لبطاقات الهدايا
const hasGiftValues = (gc) => {
  if (!gc || typeof gc !== "object") return false;
  const v = (x) => (x ?? "").toString().trim();
  return !!(v(gc.from) || v(gc.to) || v(gc.phone) || v(gc.note));
};
const normalizeGift = (gc) =>
  hasGiftValues(gc)
    ? {
        from: gc.from || "",
        to: gc.to || "",
        phone: gc.phone || "",
        note: gc.note || "",
      }
    : undefined;

// ========================= create-checkout-session =========================
router.post("/create-checkout-session", async (req, res) => {
  try {
    const {
      products,
      email,
      customerName,
      customerPhone,
      country,     // قد تكون "عُمان" أو "الإمارات" أو "السعودية"... أو "دول الخليج"
      wilayat,
      description,
      depositMode,
      giftCard,
      gulfCountry, // يبقى اختياري للجيل القديم
    } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: "Products array is required" });
    }

    const itemsCount = products.reduce(
      (t, p) => t + Math.max(1, Number(p?.quantity || 0)),
      0
    );

    // نحدد دولة الشحن الفعلية (لو جاك country="دول الخليج" نستخدم gulfCountry؛
    // ولو جاك الدولة الحقيقية في country نستخدمها مباشرة)
    const gccCountries = new Set(["الإمارات", "السعودية", "الكويت", "قطر", "البحرين", "أخرى"]);
    const isOman = country === "عُمان";
    const isGCCMode = country === "دول الخليج" || gccCountries.has(country);

    // الدولة النهائية التي سنخزنها ونرسلها في الميتاداتا
    const finalCountry =
      country === "دول الخليج" ? (gulfCountry || "") : country;

    // حساب رسوم الشحن
    // - داخل عُمان: 2
    // - الإمارات: 4 ثابت
    // - باقي الخليج: 7 لأول منتج + 3 لكل إضافي
    let shippingFee = 2;
    if (!isOman && isGCCMode) {
      const effectiveGulf = finalCountry || gulfCountry || ""; // احتياط
      if (effectiveGulf === "الإمارات") {
        shippingFee = 4; // 👈 ثابت للإمارات
      } else {
        shippingFee = 7 + Math.max(0, itemsCount - 1) * 3;
      }
    } else if (isOman) {
      shippingFee = 2;
    }

    const DEPOSIT_AMOUNT_OMR = 10;

    // بناء عناصر الدفع لثواني
    let lineItems = [];
    if (depositMode) {
      lineItems = [
        {
          name: "Deposit Payment",
          quantity: 1,
          unit_amount: toBaisa(DEPOSIT_AMOUNT_OMR),
        },
      ];
    } else {
      // المنتجات
      lineItems = products.map((p) => ({
        name: String(p.name || "Product").trim(),
        quantity: Number(p.quantity) || 1,
        unit_amount: toBaisa(p.price),
      }));
      // الشحن كبند منفصل
      lineItems.push({
        name: "Shipping Fee",
        quantity: 1,
        unit_amount: toBaisa(shippingFee),
      });
    }

    const nowId = Date.now().toString();

    // تخزين الطلب مؤقتًا في الكاش
    ORDER_CACHE.set(nowId, {
      orderId: nowId,
      products,
      email,
      customerName,
      customerPhone,
      country: finalCountry,  // نخزن الدولة النهائية
      wilayat,
      description,
      depositMode,
      giftCard,
      gulfCountry,            // اختياري - لأغراض التوافق فقط
      shippingFee,
    });

    const data = {
      client_reference_id: nowId,
      mode: "payment",
      products: lineItems,
      success_url: `http://localhost:5173/SuccessRedirect?client_reference_id=${nowId}`,
      cancel_url: "http://localhost:5173/cancel",
      metadata: {
        email,
        customer_name: customerName,
        customer_phone: customerPhone,
        country: finalCountry,  // نرسل الدولة النهائية لصفحة النجاح
        wilayat,
        description,
        gulfCountry: gulfCountry || "", // ممكن تكون فارغة
        shippingFee,
      },
    };

    console.log("=== Payload sent to Thawani ===");
    console.log(JSON.stringify(data, null, 2));

    const response = await axios.post(
      `${THAWANI_API_URL}/checkout/session`,
      data,
      {
        headers: {
          "Content-Type": "application/json",
          "thawani-api-key": THAWANI_API_KEY,
        },
      }
    );

    const sessionId = response?.data?.data?.session_id;
    if (!sessionId) {
      return res.status(500).json({
        error: "No session_id returned from Thawani",
        details: response?.data,
      });
    }

    const paymentLink = `https://uatcheckout.thawani.om/pay/${sessionId}?key=${publish_key}`;
    res.json({ id: sessionId, paymentLink });
  } catch (error) {
    console.error(
      "Error creating checkout session:",
      error?.response?.data || error.message
    );
    res.status(500).json({
      error: "Failed to create checkout session",
      details: error?.response?.data || { message: error.message },
    });
  }
});
// ========================= confirm-payment =========================
router.post("/confirm-payment", async (req, res) => {
  const { client_reference_id } = req.body;

  if (!client_reference_id) {
    return res.status(400).json({ error: "Session ID is required" });
  }

  try {
    // 1) جلب قائمة الجلسات
    const sessionsResponse = await axios.get(
      `${THAWANI_API_URL}/checkout/session/?limit=50&skip=0`,
      {
        headers: {
          "Content-Type": "application/json",
          "thawani-api-key": THAWANI_API_KEY,
        },
      }
    );

    const sessions = sessionsResponse?.data?.data || [];
    const sessionSummary = sessions.find(
      (s) => s.client_reference_id === client_reference_id
    );

    if (!sessionSummary) {
      return res.status(404).json({ error: "Session not found" });
    }

    const session_id = sessionSummary.session_id;

    // 2) تفاصيل الجلسة
    const response = await axios.get(
      `${THAWANI_API_URL}/checkout/session/${session_id}`,
      {
        headers: {
          "Content-Type": "application/json",
          "thawani-api-key": THAWANI_API_KEY,
        },
      }
    );

    const session = response?.data?.data;
    if (!session || session.payment_status !== "paid") {
      return res
        .status(400)
        .json({ error: "Payment not successful or session not found" });
    }

    // 3) البيانات من metadata أو cache
    const meta = session?.metadata || {};
    const cached = ORDER_CACHE.get(client_reference_id) || {};

    // مبلغ الدفع الفعلي بالريال (ثواني تُرجع بيسة)
    const paidAmountOMR = Number(session.total_amount || 0) / 1000;

    // معالجة المنتجات (من الكاش)
    const productsFromCache = Array.isArray(cached.products)
      ? cached.products.map((p) => ({
          productId: p.productId || p._id,
          quantity: p.quantity,
          name: p.name,
          price: p.price,
          image: Array.isArray(p.image) ? p.image[0] : p.image,
          category: p.category || "",
          measurements: p.measurements || {},
          giftCard: normalizeGift(p.giftCard),
        }))
      : [];

    // fallback للشحن
    const resolvedShippingFee =
      typeof meta.shippingFee !== "undefined"
        ? Number(meta.shippingFee)
        : cached.shippingFee ?? 2;

    // 4) إنشاء/تحديث الطلب
    let order = await Order.findOne({ orderId: client_reference_id });
    if (!order) {
      order = new Order({
        orderId: cached.orderId || client_reference_id,
        products: productsFromCache,
        amount: paidAmountOMR,
        shippingFee: resolvedShippingFee,
        customerName: cached.customerName || meta.customer_name || "",
        customerPhone: cached.customerPhone || meta.customer_phone || "",
        country: cached.country || meta.country || "", // ← الدولة النهائية
        wilayat: cached.wilayat || meta.wilayat || "",
        description: cached.description || meta.description || "",
        email: cached.email || meta.email || "",
        status: "completed",
        depositMode: !!cached.depositMode,
        remainingAmount: Number(cached.remainingAmount || 0),
        giftCard: normalizeGift(cached.giftCard),
      });
    } else {
      order.status = "completed";
      order.amount = paidAmountOMR;
      order.shippingFee = order.shippingFee ?? resolvedShippingFee;

      if (productsFromCache.length > 0) order.products = productsFromCache;

      // لو البطاقة العامة غير محفوظة وأنت حافظها في الكاش، خزّنها
      if (!hasGiftValues(order.giftCard) && hasGiftValues(cached.giftCard)) {
        order.giftCard = normalizeGift(cached.giftCard);
      }

      // اكتم بيانات العميل من الميتاداتا إذا ناقصة
      if (!order.customerName && meta.customer_name) order.customerName = meta.customer_name;
      if (!order.customerPhone && meta.customer_phone) order.customerPhone = meta.customer_phone;
      if (!order.country && meta.country) order.country = meta.country;
      if (!order.wilayat && meta.wilayat) order.wilayat = meta.wilayat;
      if (!order.description && meta.description) order.description = meta.description;
      if (!order.email && meta.email) order.email = meta.email;
    }

    order.paymentSessionId = session_id;
    order.paidAt = new Date();
    await order.save();

    // نظّف الكاش
    ORDER_CACHE.delete(client_reference_id);

    res.json({ order });
  } catch (error) {
    console.error("Error confirming payment:", error?.response?.data || error);
    res.status(500).json({
      error: "Failed to confirm payment",
      details: error?.response?.data || error.message,
    });
  }
});

// ========================= إضافية =========================

// جلب الطلب مع تفاصيل المنتجات
router.get("/order-with-products/:orderId", async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    const products = await Promise.all(
      order.products.map(async (item) => {
        const product = await Product.findById(item.productId);
        return {
          ...product.toObject(),
          quantity: item.quantity,
          selectedSize: item.selectedSize,
          price: calculateProductPrice(product, item.quantity, item.selectedSize),
        };
      })
    );

    res.json({ order, products });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get orders by email
router.get("/:email", async (req, res) => {
  try {
    const orders = await Order.find({ email: req.params.email });
    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found for this email" });
    }
    res.status(200).send({ orders });
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch orders by email" });
  }
});

// Get order by id
router.get("/order/:id", async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).send({ message: "Order not found" });
    res.status(200).send(order);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch order" });
  }
});

// Get all completed orders
router.get("/", async (req, res) => {
  try {
    const orders = await Order.find({ status: "completed" }).sort({ createdAt: -1 });
    if (orders.length === 0) {
      return res.status(404).send({ message: "No orders found", orders: [] });
    }
    res.status(200).send(orders);
  } catch (error) {
    res.status(500).send({ message: "Failed to fetch all orders" });
  }
});

// Update order status
router.patch("/update-order-status/:id", async (req, res) => {
  try {
    const updatedOrder = await Order.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!updatedOrder) return res.status(404).send({ message: "Order not found" });
    res.status(200).json({ message: "Order status updated successfully", order: updatedOrder });
  } catch (error) {
    res.status(500).send({ message: "Failed to update order status" });
  }
});

// Delete order
router.delete("/delete-order/:id", async (req, res) => {
  try {
    const deletedOrder = await Order.findByIdAndDelete(req.params.id);
    if (!deletedOrder) return res.status(404).send({ message: "Order not found" });
    res.status(200).json({ message: "Order deleted successfully", order: deletedOrder });
  } catch (error) {
    res.status(500).send({ message: "Failed to delete order" });
  }
});

// Helper لحساب سعر المنتج
function calculateProductPrice(product, quantity, selectedSize) {
  if (
    product.category === "حناء بودر" &&
    selectedSize &&
    product.price[selectedSize]
  ) {
    return (product.price[selectedSize] * quantity).toFixed(2);
  }
  return (product.regularPrice * quantity).toFixed(2);
}

module.exports = router;
