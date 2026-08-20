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
  if(!verifyEcpay(req.body)){
    return res.redirect("/?payment=failed");
  }
  const order = markOrder(req.body);
  if(order.status !== "paid"){
    return res.redirect("/?payment=failed");
  }
  const type = encodeURIComponent(order.kind);
  const id = encodeURIComponent(order.merchantTradeNo);
  return res.redirect(`/?payment=success&type=${type}&order=${id}`);
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

app.use(express.static(path.join(__dirname,"public")));

app.listen(PORT,()=>{
  console.log(`Magic Oracle running at http://localhost:${PORT}`);
  console.log(`ECPay mode: ${MODE}`);
  if(PUBLIC_BASE_URL.startsWith("http://localhost")){
    console.log("NOTE: ECPay ReturnURL needs a public HTTPS URL for full callback testing.");
  }
});
