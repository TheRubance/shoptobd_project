// auth/otpUtils.js
const crypto = require('crypto');

// Generate a 6-digit OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate OTP Expiry Time (valid for 10 minutes)
function getOTPExpiry() {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 10);
    return now;
}

module.exports = { generateOTP, getOTPExpiry };
