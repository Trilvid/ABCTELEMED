require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    const exists = await Admin.findOne({ role: 'superAdmin' });
    if (exists) { console.log('SuperAdmin already exists:', exists.email); process.exit(0); }
    const admin = await Admin.create({
        firstName: 'Super',
        lastName: 'Admin',
        email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@abctelemedica.ng',
        password: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!',
        role: 'superAdmin',
    });
    console.log('SuperAdmin created:', admin.email);
    process.exit(0);
}
seed().catch(err => { console.error(err); process.exit(1); });
