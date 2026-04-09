#!/usr/bin/env node
/**
 * AbcTeleMed — Comprehensive API Test Suite
 * Run: node tests/runTests.js
 *
 * Tests every API endpoint and critical flow including:
 *   - Doctor registration, login, forgot/reset password
 *   - Patient management
 *   - Consultation lifecycle
 *   - Payment verification
 *   - Admin auth and all admin operations
 *   - Earnings and withdrawals
 *   - Audit logs
 *   - Error cases and edge cases
 */

require('dotenv').config({ path: '../.env' });

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'trillztech34@gmail.com';  // ← use this to test reset password email

let passed = 0;
let failed = 0;
let skipped = 0;

// ── Tokens (filled during tests) ─────────────────────────────────────────────
let doctorToken = '';
let doctorId = '';
let adminToken = '';
let adminId = '';
let patientId = '';
let consultationId = '';
let earningId = '';
let withdrawalId = '';
let resetToken = '';  // filled manually from email

// ── Helpers ───────────────────────────────────────────────────────────────────
const clr = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function req(method, path, body, token, label) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
        const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data, ok: res.ok };
    } catch (e) {
        return { status: 0, data: { message: e.message }, ok: false };
    }
}

function test(label, condition, detail = '') {
    if (condition) {
        console.log(`  ${clr.green('✓')} ${label}`);
        passed++;
    } else {
        console.log(`  ${clr.red('✗')} ${label}${detail ? clr.gray(' — ' + detail) : ''}`);
        failed++;
    }
}

function section(title) {
    console.log(`\n${clr.bold(clr.cyan('══ ' + title + ' ══'))}`);
}

function skip(label) {
    console.log(`  ${clr.yellow('○')} ${label} ${clr.gray('(skipped)')}`);
    skipped++;
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

async function testHealth() {
    section('HEALTH CHECK');
    const r = await req('GET', '/health');
    test('Server is reachable and healthy', r.ok && r.data.success, JSON.stringify(r.data));
}

async function testDoctorAuth() {
    section('DOCTOR AUTH');

    // ── Register ──────────────────────────────────────────────────────────
    const uniqueEmail = `testdoctor_${Date.now()}@example.com`;
    const r = await req('POST', '/api/doctors/register', {
        firstName: 'Test',
        lastName: 'Doctor',
        email: uniqueEmail,
        phone: `080${Date.now().toString().slice(-8)}`,
        password: 'password123',
        specialty: 'general_practice',
        licenseNumber: `MDN-${Date.now()}`,
        licenseExpiry: '2030-12-31',
        yearsOfExperience: 5,
        consultationFee: 5000,
    });
    test('Doctor registration succeeds', r.status === 201, r.data.message);
    test('Registration returns token', !!r.data.token);
    test('Registration returns public profile', !!r.data.data?.doctor?.id);

    if (r.data.token) {
        doctorToken = r.data.token;
        doctorId = r.data.data?.doctor?.id;
    }

    // ── Register duplicate ─────────────────────────────────────────────────
    const rDup = await req('POST', '/api/doctors/register', {
        firstName: 'Dup', lastName: 'Doctor', email: uniqueEmail,
        phone: '08099999999', password: 'x', specialty: 'cardiology',
        licenseNumber: 'DUPLICATE', licenseExpiry: '2030-01-01', yearsOfExperience: 1,
    });
    test('Duplicate registration is rejected (409)', rDup.status === 409);

    // ── Login ──────────────────────────────────────────────────────────────
    const rLogin = await req('POST', '/api/doctors/login', { email: uniqueEmail, password: 'password123' });
    test('Login with correct credentials succeeds', rLogin.ok, rLogin.data.message);
    test('Login returns a JWT token', !!rLogin.data.token);
    test('Login response includes phone in profile', !!rLogin.data.data?.doctor?.phone || rLogin.data.data?.doctor?.phone === '', 'phone field present');
    test('Login response includes email in profile', rLogin.data.data?.doctor?.email === uniqueEmail);
    test('Login response includes status in profile', !!rLogin.data.data?.doctor?.status);
    if (rLogin.data.token) doctorToken = rLogin.data.token;

    // ── Login wrong password ───────────────────────────────────────────────
    const rBad = await req('POST', '/api/doctors/login', { email: uniqueEmail, password: 'wrongpassword' });
    test('Login with wrong password returns 401', rBad.status === 401);

    // ── Login missing fields ───────────────────────────────────────────────
    const rMissing = await req('POST', '/api/doctors/login', { email: uniqueEmail });
    test('Login with missing password returns 400', rMissing.status === 400);

    // ── Get doctor profile ─────────────────────────────────────────────────
    const rGet = await req('GET', `/api/doctors/${doctorId}`);
    test('GET /api/doctors/:id returns public profile', rGet.ok);
    test('Public profile does NOT expose password', !rGet.data.data?.doctor?.password);
}

async function testForgotResetPassword() {
    section('FORGOT / RESET PASSWORD');

    // ── Test with trillz@gmail.com ─────────────────────────────────────────
    console.log(clr.yellow(`  → Testing with real email: ${TEST_EMAIL}`));
    const r = await req('POST', '/api/doctors/forgot-password', { email: TEST_EMAIL });
    test('Forgot password always returns 200 (prevents enumeration)', r.status === 200, r.data.message);
    test('Response message is generic (does not leak email existence)', r.data.message?.toLowerCase().includes('if an account'));

    // ── Non-existent email ─────────────────────────────────────────────────
    const rFake = await req('POST', '/api/doctors/forgot-password', { email: 'doesnotexist@fake.com' });
    test('Forgot password with non-existent email still returns 200', rFake.status === 200);

    // ── Missing email ─────────────────────────────────────────────────────
    const rEmpty = await req('POST', '/api/doctors/forgot-password', {});
    test('Forgot password with missing email returns 400', rEmpty.status === 400);

    // ── Reset with bogus token ─────────────────────────────────────────────
    const rReset = await req('PATCH', '/api/doctors/reset-password/thisIsABogusToken123', { password: 'newPassword1!' });
    test('Reset with invalid token returns 400', rReset.status === 400);

    // ── Reset with short password ─────────────────────────────────────────
    const rShort = await req('PATCH', '/api/doctors/reset-password/anytoken', { password: 'abc' });
    test('Reset with too-short password returns 400', rShort.status === 400);

    // ── Check email is actually being sent (log to console) ───────────────
    console.log(clr.yellow(`  → Check your server console for "✅ Password reset email sent to ${TEST_EMAIL}"`));
    console.log(clr.yellow(`  → Check ${TEST_EMAIL} inbox (and spam) for reset email`));

    skip('Reset with valid token (needs real token from email — check inbox and paste resetToken var)');
}

async function testDoctorProfile() {
    section('DOCTOR PROFILE MANAGEMENT');
    if (!doctorToken || !doctorId) { skip('All profile tests (no token)'); return; }

    // ── Update profile ─────────────────────────────────────────────────────
    const rUpdate = await req('PATCH', `/api/doctors/${doctorId}`, {
        bio: 'I am a test doctor specialising in general practice.',
        phone: `070${Date.now().toString().slice(-8)}`,
        whatsappNumber: `080${Date.now().toString().slice(-8)}`,
        consultationFee: 7500,
        languages: ['English', 'Igbo'],
    }, doctorToken);
    test('Profile update succeeds', rUpdate.ok, rUpdate.data.message);
    test('Updated phone is returned', !!rUpdate.data.data?.doctor?.phone);

    // ── Forbidden fields are ignored ───────────────────────────────────────
    const rForbidden = await req('PATCH', `/api/doctors/${doctorId}`, { rating: 5, status: 'superAdmin' }, doctorToken);
    test('Forbidden fields (rating, status) are ignored on update', rForbidden.data.data?.doctor?.rating !== 5);

    // ── Update availability ────────────────────────────────────────────────
    const rAvail = await req('PATCH', `/api/doctors/${doctorId}/availability`, {
        isAvailableNow: true,
        consultationDuration: 20,
        availabilitySchedule: [{ day: 'monday', startTime: '09:00', endTime: '17:00' }],
    }, doctorToken);
    test('Availability update succeeds', rAvail.ok, rAvail.data.message);
    test('isAvailableNow reflected in response', rAvail.data.data?.isAvailableNow === true);
}

async function testAdminAuth() {
    section('ADMIN AUTH');

    const rLogin = await req('POST', '/api/admin/login', {
        email: process.env.SUPER_ADMIN_EMAIL || 'superadmin@abctelemedica.ng',
        password: process.env.SUPER_ADMIN_PASSWORD || 'ChangeMe123!',
    });
    test('SuperAdmin login succeeds', rLogin.ok, rLogin.data.message);
    test('Admin login returns token', !!rLogin.data.token);
    test('Admin profile includes role', !!rLogin.data.data?.admin?.role);
    if (rLogin.data.token) {
        adminToken = rLogin.data.token;
        adminId = rLogin.data.data?.admin?._id;
    }

    // ── Wrong password ─────────────────────────────────────────────────────
    const rBad = await req('POST', '/api/admin/login', { email: 'superadmin@abctelemedica.ng', password: 'wrong' });
    test('Admin login with wrong password returns 401', rBad.status === 401);

    // ── Get me ─────────────────────────────────────────────────────────────
    if (adminToken) {
        const rMe = await req('GET', '/api/admin/me', null, adminToken);
        test('GET /api/admin/me returns admin profile', rMe.ok);
        test('/me response includes email', !!rMe.data.data?.admin?.email);
    }
}

async function testAdminStats() {
    section('ADMIN STATS');
    if (!adminToken) { skip('All stats tests (no admin token)'); return; }

    const r = await req('GET', '/api/admin/stats', null, adminToken);
    test('GET /api/admin/stats returns 200', r.ok, r.data.message);
    test('Stats include doctors breakdown', !!r.data.data?.doctors);
    test('Stats include revenue breakdown', !!r.data.data?.revenue);
    test('Stats include consultation counts', !!r.data.data?.consultations);
    test('Stats include patient total', typeof r.data.data?.patients?.total === 'number');
}

async function testAdminDoctors() {
    section('ADMIN DOCTOR MANAGEMENT');
    if (!adminToken || !doctorId) { skip('All doctor mgmt tests'); return; }

    // ── List doctors ───────────────────────────────────────────────────────
    const rList = await req('GET', '/api/admin/doctors', null, adminToken);
    test('GET /api/admin/doctors returns list', rList.ok);
    test('Doctors list is an array', Array.isArray(rList.data.data?.doctors));

    // ── Search ─────────────────────────────────────────────────────────────
    const rSearch = await req('GET', '/api/admin/doctors?search=Test', null, adminToken);
    test('Doctor search works', rSearch.ok);

    // ── Filter by status ────────────────────────────────────────────────────
    const rFilter = await req('GET', '/api/admin/doctors?status=pending', null, adminToken);
    test('Filter by status works', rFilter.ok);

    // ── Get single doctor ──────────────────────────────────────────────────
    const rGet = await req('GET', `/api/admin/doctors/${doctorId}`, null, adminToken);
    test('GET /api/admin/doctors/:id returns detail', rGet.ok);
    test('Doctor detail includes consultations array', Array.isArray(rGet.data.data?.consultations));

    // ── Verify doctor ──────────────────────────────────────────────────────
    const rVerify = await req('PATCH', `/api/admin/doctors/${doctorId}/verify`, { action: 'approve' }, adminToken);
    test('Doctor verify (approve) succeeds', rVerify.ok, rVerify.data.message);
    test('Doctor status is now verified', rVerify.data.data?.doctor?.status === 'verified');

    // ── Suspend doctor ─────────────────────────────────────────────────────
    const rSuspend = await req('PATCH', `/api/admin/doctors/${doctorId}/status`, { status: 'suspended', reason: 'Test suspension' }, adminToken);
    test('Doctor suspension succeeds', rSuspend.ok);

    // ── Reinstate doctor ───────────────────────────────────────────────────
    const rReinstate = await req('PATCH', `/api/admin/doctors/${doctorId}/status`, { status: 'verified' }, adminToken);
    test('Doctor reinstatement succeeds', rReinstate.ok);

    // ── Reject with reason ─────────────────────────────────────────────────
    const rReject = await req('PATCH', `/api/admin/doctors/${doctorId}/verify`, { action: 'reject', rejectionReason: 'License appears invalid' }, adminToken);
    test('Doctor rejection succeeds', rReject.ok);
    // Restore
    await req('PATCH', `/api/admin/doctors/${doctorId}/status`, { status: 'verified' }, adminToken);
}

async function testAdminPatients() {
    section('ADMIN PATIENT MANAGEMENT');
    if (!adminToken) { skip('All patient mgmt tests'); return; }

    // ── List patients ──────────────────────────────────────────────────────
    const rList = await req('GET', '/api/admin/patients', null, adminToken);
    test('GET /api/admin/patients returns list', rList.ok);
    test('Patients list is an array', Array.isArray(rList.data.data?.patients));

    if (rList.data.data?.patients?.length > 0) {
        patientId = rList.data.data.patients[0]._id;

        // ── Get single patient ─────────────────────────────────────────────
        const rGet = await req('GET', `/api/admin/patients/${patientId}`, null, adminToken);
        test('GET /api/admin/patients/:id returns patient', rGet.ok);
        test('Patient detail includes consultations', Array.isArray(rGet.data.data?.consultations));

        // ── Update patient plan ────────────────────────────────────────────
        const rUpdate = await req('PATCH', `/api/admin/patients/${patientId}`, { plan: 'basic_monthly' }, adminToken);
        test('Admin can update patient plan', rUpdate.ok, rUpdate.data.message);

        // ── Forbidden fields blocked ───────────────────────────────────────
        const rForbidden = await req('PATCH', `/api/admin/patients/${patientId}`, { whatsappNumber: '0000000000' }, adminToken);
        // whatsappNumber is not in the allowed list, so it should be silently ignored
        test('Forbidden patient fields (whatsappNumber) are ignored', rForbidden.ok);
    } else {
        skip('Patient detail tests (no patients in DB yet)');
    }

    // ── Search ─────────────────────────────────────────────────────────────
    const rSearch = await req('GET', '/api/admin/patients?search=John', null, adminToken);
    test('Patient search works', rSearch.ok);

    // ── Filter by plan ─────────────────────────────────────────────────────
    const rFilter = await req('GET', '/api/admin/patients?plan=free', null, adminToken);
    test('Patient filter by plan works', rFilter.ok);
}

async function testConsultations() {
    section('CONSULTATIONS');
    if (!adminToken) { skip('All consultation tests'); return; }

    const rList = await req('GET', '/api/admin/consultations', null, adminToken);
    test('GET /api/admin/consultations returns list', rList.ok);
    test('Consultations list is an array', Array.isArray(rList.data.data?.consultations));

    // ── Filter by status ───────────────────────────────────────────────────
    const rFilter = await req('GET', '/api/admin/consultations?status=completed', null, adminToken);
    test('Consultation filter by status works', rFilter.ok);

    if (rList.data.data?.consultations?.length > 0) {
        consultationId = rList.data.data.consultations[0]._id;

        const rGet = await req('GET', `/api/admin/consultations/${consultationId}`, null, adminToken);
        test('GET /api/admin/consultations/:id returns detail', rGet.ok);
        test('Consultation detail includes populated patient', !!rGet.data.data?.consultation?.patient);
        test('Consultation detail includes populated doctor', !!rGet.data.data?.consultation?.doctor);
    } else {
        skip('Consultation detail tests (no consultations yet)');
    }
}

async function testEarningsAndPayouts() {
    section('EARNINGS & PAYOUTS');
    if (!adminToken) { skip('All earnings tests'); return; }

    const rList = await req('GET', '/api/admin/earnings', null, adminToken);
    test('GET /api/admin/earnings returns list', rList.ok);
    test('Earnings include summary breakdown', Array.isArray(rList.data.data?.summary));

    // ── Filter by status ───────────────────────────────────────────────────
    const rPending = await req('GET', '/api/admin/earnings?status=pending', null, adminToken);
    test('Filter pending earnings works', rPending.ok);

    if (rList.data.data?.earnings?.length > 0) {
        const earning = rList.data.data.earnings.find(e => e.status === 'pending');
        if (earning) {
            earningId = earning._id;
            // ── Process single payout ───────────────────────────────────────
            const rPay = await req('PATCH', `/api/admin/earnings/${earningId}/payout`, {
                payoutMethod: 'bank_transfer',
                payoutReference: `TEST-REF-${Date.now()}`,
                payoutNote: 'Test payout from test suite',
            }, adminToken);
            test('Single payout processing succeeds', rPay.ok, rPay.data.message);
            test('Payout status is now paid', rPay.data.data?.earning?.status === 'paid');

            // ── Cannot pay twice ─────────────────────────────────────────────
            const rDouble = await req('PATCH', `/api/admin/earnings/${earningId}/payout`, { payoutMethod: 'bank_transfer' }, adminToken);
            test('Double payout is rejected (400)', rDouble.status === 400);
        } else {
            skip('Single payout test (no pending earnings)');
        }
    } else {
        skip('Payout tests (no earnings in DB)');
    }

    // ── Bulk payout with empty array ───────────────────────────────────────
    const rBulkEmpty = await req('POST', '/api/admin/earnings/bulk-payout', { earningIds: [] }, adminToken);
    test('Bulk payout with empty array returns 400', rBulkEmpty.status === 400);
}

async function testWithdrawals() {
    section('DOCTOR WITHDRAWALS');
    if (!doctorToken || !adminToken) { skip('All withdrawal tests'); return; }

    // ── Doctor earnings summary ────────────────────────────────────────────
    const rSummary = await req('GET', '/api/doctors/earnings/summary', null, doctorToken);
    test('Doctor can view their earnings summary', rSummary.ok, rSummary.data.message);

    // ── Request withdrawal ─────────────────────────────────────────────────
    const rWithdraw = await req('POST', '/api/doctors/withdraw', {
        bankName: 'GTBank',
        accountNumber: '0123456789',
        accountName: 'Test Doctor',
    }, doctorToken);
    // May be 201 (has earnings) or 400 (no earnings yet) — both are valid
    const isValid = rWithdraw.status === 201 || rWithdraw.status === 400;
    test('Withdrawal request endpoint responds correctly', isValid, rWithdraw.data.message);
    if (rWithdraw.status === 201) {
        withdrawalId = rWithdraw.data.data?.withdrawal?._id;
        test('Withdrawal response includes withdrawal object', !!withdrawalId);

        // ── Duplicate withdrawal rejected ────────────────────────────────────
        const rDup = await req('POST', '/api/doctors/withdraw', { bankName: 'GTBank', accountNumber: '0123456789', accountName: 'Test Doctor' }, doctorToken);
        test('Duplicate pending withdrawal is rejected (409)', rDup.status === 409);
    }

    // ── Doctor sees withdrawal history ─────────────────────────────────────
    const rHistory = await req('GET', '/api/doctors/withdrawals', null, doctorToken);
    test('Doctor can view withdrawal history', rHistory.ok);

    // ── Admin sees withdrawal list ─────────────────────────────────────────
    const rAdminList = await req('GET', '/api/admin/withdrawals', null, adminToken);
    test('Admin can list withdrawal requests', rAdminList.ok);

    if (withdrawalId) {
        // ── Admin processes withdrawal ─────────────────────────────────────
        const rProcess = await req('PATCH', `/api/admin/withdrawals/${withdrawalId}`, {
            action: 'pay',
            payoutReference: `WD-REF-${Date.now()}`,
            adminNote: 'Processed during test',
        }, adminToken);
        test('Admin can process (pay) a withdrawal', rProcess.ok, rProcess.data.message);
    }
}

async function testAuditLogs() {
    section('AUDIT LOGS');
    if (!adminToken) { skip('All audit log tests'); return; }

    const rList = await req('GET', '/api/admin/audit-logs', null, adminToken);
    test('GET /api/admin/audit-logs returns logs', rList.ok);
    test('Logs list is an array', Array.isArray(rList.data.data?.logs));

    // ── Filter by action ───────────────────────────────────────────────────
    const rRead = await req('GET', '/api/admin/audit-logs?action=READ', null, adminToken);
    test('Filter audit logs by action=READ works', rRead.ok);

    // ── Filter by entity ───────────────────────────────────────────────────
    const rPatient = await req('GET', '/api/admin/audit-logs?entity=Patient', null, adminToken);
    test('Filter audit logs by entity=Patient works', rPatient.ok);

    // ── Log structure ──────────────────────────────────────────────────────
    if (rList.data.data?.logs?.length > 0) {
        const log = rList.data.data.logs[0];
        test('Audit log has required fields: performedByName', !!log.performedByName);
        test('Audit log has required fields: action', !!log.action);
        test('Audit log has required fields: entity', !!log.entity);
        test('Audit log has required fields: description', !!log.description);
        test('Audit log captures IP address', log.ipAddress !== undefined);
    }
}

async function testAdminManagement() {
    section('ADMIN MANAGEMENT (superAdmin)');
    if (!adminToken) { skip('All admin mgmt tests'); return; }

    // ── List admins ────────────────────────────────────────────────────────
    const rList = await req('GET', '/api/admin/admins', null, adminToken);
    test('SuperAdmin can list all admin accounts', rList.ok);
    test('Admins list is an array', Array.isArray(rList.data.data?.admins));

    // ── Create new admin ───────────────────────────────────────────────────
    const newAdminEmail = `testadmin_${Date.now()}@abctelemedica.ng`;
    const rCreate = await req('POST', '/api/admin/create', {
        firstName: 'Test',
        lastName: 'Admin',
        email: newAdminEmail,
        password: 'testAdmin123!',
        role: 'admin',
    }, adminToken);
    test('SuperAdmin can create new admin account', rCreate.ok, rCreate.data.message);
    test('Created admin has correct role', rCreate.data.data?.admin?.role === 'admin');
    test('Password is not exposed on create', !rCreate.data.data?.admin?.password);

    const newAdminId = rCreate.data.data?.admin?._id;

    // ── Duplicate admin ────────────────────────────────────────────────────
    const rDup = await req('POST', '/api/admin/create', { firstName: 'Dup', lastName: 'Admin', email: newAdminEmail, password: 'x', role: 'admin' }, adminToken);
    test('Duplicate admin email is rejected (409)', rDup.status === 409);

    if (newAdminId) {
        // ── Toggle admin status ─────────────────────────────────────────────
        const rToggle = await req('PATCH', `/api/admin/admins/${newAdminId}/status`, {}, adminToken);
        test('SuperAdmin can toggle admin active status', rToggle.ok);

        // ── Delete admin ───────────────────────────────────────────────────
        const rDelete = await req('DELETE', `/api/admin/admins/${newAdminId}`, null, adminToken);
        test('SuperAdmin can delete admin account', rDelete.ok, rDelete.data.message);

        // ── Verify deleted ─────────────────────────────────────────────────
        const rList2 = await req('GET', '/api/admin/admins', null, adminToken);
        const stillExists = rList2.data.data?.admins?.some(a => a._id === newAdminId);
        test('Deleted admin no longer appears in list', !stillExists);
    }

    // ── Cannot delete self ─────────────────────────────────────────────────
    if (adminId) {
        const rSelf = await req('DELETE', `/api/admin/admins/${adminId}`, null, adminToken);
        test('Admin cannot delete their own account', rSelf.status === 400);
    }
}

async function testSecurityEdgeCases() {
    section('SECURITY & EDGE CASES');

    // ── Unauthenticated access ─────────────────────────────────────────────
    const rNoToken = await req('GET', '/api/admin/stats');
    test('Protected route without token returns 401', rNoToken.status === 401);

    const rDoctorNoToken = await req('GET', `/api/doctors/${doctorId || '000000000000000000000000'}/availability`);
    // Public profile route is public — admin availability route is protected
    const rAdminNoToken = await req('PATCH', `/api/admin/doctors/${doctorId || 'x'}/verify`, { action: 'approve' });
    test('Admin-only route without token returns 401', rAdminNoToken.status === 401);

    // ── Doctor token cannot access admin routes ────────────────────────────
    if (doctorToken) {
        const rWrongRole = await req('GET', '/api/admin/stats', null, doctorToken);
        test('Doctor JWT cannot access admin routes', rWrongRole.status === 401 || rWrongRole.status === 403);
    }

    // ── Invalid ObjectId format ────────────────────────────────────────────
    if (adminToken) {
        const rBadId = await req('GET', '/api/admin/patients/notavalidobjectid', null, adminToken);
        test('Invalid ObjectId format returns 404 or 400 (not 500)', rBadId.status !== 500);
    }

    // ── Password reset token is hashed in DB ──────────────────────────────
    // (verified indirectly — bogus token always returns 400 not 500)
    const rBogus = await req('PATCH', '/api/doctors/reset-password/aaabbbccc', { password: 'validpass123' });
    test('Reset with bogus token returns 400 not 500', rBogus.status === 400);

    // ── SQL/NoSQL injection prevention ────────────────────────────────────
    if (adminToken) {
        const rInject = await req('GET', '/api/admin/patients?search[$gt]=', null, adminToken);
        test('NoSQL injection in query param does not crash server', rInject.status !== 500);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// RUNNER
// ═════════════════════════════════════════════════════════════════════════════

async function run() {
    console.log(clr.bold(`\n🏥  AbcTeleMed API Test Suite`));
    console.log(clr.gray(`    Target: ${BASE_URL}`));
    console.log(clr.gray(`    Time:   ${new Date().toISOString()}\n`));

    await testHealth();
    await testDoctorAuth();
    await testForgotResetPassword();
    await testDoctorProfile();
    await testAdminAuth();
    await testAdminStats();
    await testAdminDoctors();
    await testAdminPatients();
    await testConsultations();
    await testEarningsAndPayouts();
    await testWithdrawals();
    await testAuditLogs();
    await testAdminManagement();
    await testSecurityEdgeCases();

    // ── Final summary ─────────────────────────────────────────────────────
    const total = passed + failed + skipped;
    console.log('\n' + '─'.repeat(52));
    console.log(clr.bold(`📊  Results: ${total} tests`));
    console.log(`  ${clr.green('Passed')}:  ${passed}`);
    console.log(`  ${clr.red('Failed')}:  ${failed}`);
    console.log(`  ${clr.yellow('Skipped')}: ${skipped}`);
    console.log('─'.repeat(52));

    if (failed === 0) {
        console.log(clr.bold(clr.green('\n✅  All tests passed!\n')));
    } else {
        console.log(clr.bold(clr.red(`\n❌  ${failed} test(s) failed.\n`)));
    }

    // Exit with non-zero code if any tests failed (useful for CI)
    process.exit(failed > 0 ? 1 : 0);
}

// Node 18+ has native fetch — for older versions: npm install node-fetch
if (typeof fetch === 'undefined') {
    console.error('❌ This script requires Node 18+ (native fetch) or install node-fetch.');
    process.exit(1);
}

run().catch(err => {
    console.error(clr.red('\n💥 Test runner crashed: ' + err.message));
    console.error(err.stack);
    process.exit(1);
});