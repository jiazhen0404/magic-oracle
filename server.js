const express = require("express");
const crypto = require("crypto");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const MODE = (process.env.ECPAY_MODE || "stage").toLowerCase();
const MERCHANT_ID = process.env.ECPAY_MERCHANT_ID || "3002607";
const HASH_KEY = process.env.ECPAY_HASH_KEY || "pwFHCqoQZGmho4w6";
const HASH_IV = process.env.ECPAY_HASH_IV || "EkRm7iFT261dpevs";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/,"");

const PAYMENT_URL = MODE === "production"
  ? "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5"
  : "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";

// Demo only. Use a persistent database in production.
const orders = new Map();

function ecpayUrlEncode(str){
  // ECPay AioCheckOut uses RFC1866-like encoding:
  // spaces -> +, then lowercase before SHA256.
  return encodeURIComponent(str)
    .replace(/%20/g, "+")
    .replace(/%2D/gi, "-")
    .replace(/%5F/gi, "_")
    .replace(/%2E/gi, ".")
    .replace(/%21/gi, "!")
    .replace(/%2A/gi, "*")
    .replace(/%28/gi, "(")
    .replace(/%29/gi, ")");
}

function checkMacValue(data){
  const params = Object.entries(data)
    .filter(([k]) => k !== "CheckMacValue")
    .sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`)
    .join("&");

  const raw = `HashKey=${HASH_KEY}&${params}&HashIV=${HASH_IV}`;
  const encoded = ecpayUrlEncode(raw).toLowerCase();

  return crypto
    .createHash("sha256")
    .update(encoded, "utf8")
    .digest("hex")
    .toUpperCase();
}

function tradeNo(){
  // <=20 chars, unique enough for this MVP.
  return "MO" + Date.now().toString(36).toUpperCase() +
    crypto.randomBytes(3).toString("hex").toUpperCase();
}

function tradeDate(){
  const d = new Date();
  const pad=n=>String(n).padStart(2,"0");
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function safeKind(kind){
  return "draw";
}

app.post("/api/ecpay/create-order",(req,res)=>{
  const kind = "draw";
  const amount = Number(req.body.amount);

  if(amount !== 50){
    return res.status(400).send("Invalid payment request.");
  }

  const merchantTradeNo = tradeNo();
  const itemName = "未完籤所 單次抽籤";
  const tradeDesc = "Magic Oracle Draw";

  const fields = {
    MerchantID: MERCHANT_ID,
    MerchantTradeNo: merchantTradeNo,
    MerchantTradeDate: tradeDate(),
    PaymentType: "aio",
    TotalAmount: amount,
    TradeDesc: tradeDesc,
    ItemName: itemName,
    ReturnURL: `${PUBLIC_BASE_URL}/api/ecpay/callback`,
    OrderResultURL: `${PUBLIC_BASE_URL}/api/ecpay/result`,
    ChoosePayment: "ALL",
    EncryptType: 1,
    CustomField1: kind,
    CustomField2: String(amount)
  };

  fields.CheckMacValue = checkMacValue(fields);

  orders.set(merchantTradeNo,{
    merchantTradeNo,
    kind,
    amount,
    status:"created",
    createdAt:Date.now()
  });

  res.json({paymentUrl:PAYMENT_URL, fields});
});

function verifyEcpay(body){
  if(!body || !body.CheckMacValue) return false;
  const expected = checkMacValue(body);
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(String(body.CheckMacValue).toUpperCase())
  );
}

function markOrder(body){
  const id = body.MerchantTradeNo;
  const order = orders.get(id) || {
    merchantTradeNo:id,
    kind:safeKind(body.CustomField1),
    amount:Number(body.CustomField2 || body.TradeAmt || 0),
    createdAt:Date.now()
  };

  order.status = String(body.RtnCode) === "1" ? "paid" : "failed";
  order.tradeNo = body.TradeNo || "";
  order.paymentDate = body.PaymentDate || "";
  order.rtnMsg = body.RtnMsg || "";
  orders.set(id,order);
  return order;
}

// Server-to-server payment notification.
// ECPay requires response body exactly 1|OK after successful receipt.
app.post("/api/ecpay/callback",(req,res)=>{
  if(!verifyEcpay(req.body)){
    return res.status(400).send("0|CheckMacValueError");
  }
  markOrder(req.body);
  res.type("text/plain").send("1|OK");
});

// Browser payment result POST (for real-time payment types).
app.post("/api/ecpay/result",(req,res)=>{
  const macValid = verifyEcpay(req.body);

  console.log("=== ECPAY RESULT ===");
  console.log("MerchantTradeNo:", req.body.MerchantTradeNo);
  console.log("RtnCode:", req.body.RtnCode);
  console.log("RtnMsg:", req.body.RtnMsg);
  console.log("TradeAmt:", req.body.TradeAmt);
  console.log("PaymentType:", req.body.PaymentType);
  console.log("CheckMacValue valid:", macValid);
  console.log("====================");

  if(!macValid){
    return res.redirect("/?payment=failed&reason=mac");
  }

  const order = markOrder(req.body);

  if(String(req.body.RtnCode) !== "1"){
    return res.redirect(
      `/?payment=failed&reason=rtn&rtnCode=${encodeURIComponent(req.body.RtnCode || "")}`
    );
  }

  const type = encodeURIComponent(order.kind);
  const id = encodeURIComponent(order.merchantTradeNo);

  return res.redirect(
    `/?payment=success&type=${type}&order=${id}`
  );
});

app.get("/api/ecpay/order/:id",(req,res)=>{
  const order = orders.get(req.params.id);
  if(!order) return res.status(404).json({error:"not_found"});
  res.json({
    merchantTradeNo:order.merchantTradeNo,
    kind:order.kind,
    amount:order.amount,
    status:order.status
  });
});

// Legacy SEO entry links used ?entry=breakup. Always send them into the real oracle flow.
app.get("/", (req,res,next)=>{
  if(req.query && req.query.entry){
    return res.redirect(302, "/#start");
  }
  next();
});

// Static files: keep HTML fresh, cache images/data safely.
const PUBLIC_DIR = path.join(__dirname,"public");
const APP_INDEX = path.join(__dirname,"index.html");

// The lightweight oracle UI and its split assets live at the project root.
// Keep the URL structure stable without exposing the rest of the project as
// static files. (The old public/index.html is a legacy embedded landing build.)
app.use("/assets", express.static(path.join(__dirname,"assets"), { maxAge: "30d", immutable: true }));
app.use("/data", express.static(path.join(__dirname,"data"), { maxAge: "5m" }));
app.use(express.static(PUBLIC_DIR, {
  index: false,
  setHeaders(res, filePath){
    if(filePath.endsWith(".html")){
      res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
    }
  }
}));

// Crawlable SEO landing pages with unique metadata and copy.
const SEO_DIR = __dirname;
app.get(/^\/(love|work|choice|life|pet)(?:\/([a-z0-9-]+))?\/?$/, (req,res,next)=>{
  const category = req.params[0];
  const sub = req.params[1];
  const filePath = sub ? path.join(SEO_DIR, category, sub, "index.html") : path.join(SEO_DIR, category, "index.html");
  res.setHeader("Cache-Control","public, max-age=300");
  res.sendFile(filePath, err=>{ if(err) next(); });
});

// App fallback: query-string entries and non-file routes still load the oracle UI.
app.get("*", (req,res,next)=>{
  if(req.path.startsWith("/api/")) return next();
  res.setHeader("Cache-Control","no-cache, no-store, must-revalidate");
  return res.sendFile(APP_INDEX);
});

app.listen(PORT,()=>{
  console.log(`Magic Oracle running at http://localhost:${PORT}`);
  console.log(`ECPay mode: ${MODE}`);
  if(PUBLIC_BASE_URL.startsWith("http://localhost")){
    console.log("NOTE: ECPay ReturnURL needs a public HTTPS URL for full callback testing.");
  }
});
