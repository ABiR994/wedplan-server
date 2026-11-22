<div align="center">

<img src="https://raw.githubusercontent.com/ABiR994/webplan-client/main/public/logo.svg" alt="WedPlan Logo" width="90" />

# WedPlan – Backend API

### Secure services, bookings and subscriptions behind every wedding plan.

A RESTful backend API for WedPlan, a role-based wedding planning platform where customers book wedding services, vendors manage their listings and admins oversee the marketplace. Built with Express.js, MongoDB, JWT authentication and Stripe.

<br />

[![Live Application](https://img.shields.io/badge/Live%20Application-Visit%20Website-9f4f63?style=for-the-badge&logo=vercel&logoColor=white)](https://webplan-gilt.vercel.app/)
[![Server Repository](https://img.shields.io/badge/Server%20Source-GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/ABiR994/wedplan-server)
[![Client Repository](https://img.shields.io/badge/Client%20Source-GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/ABiR994/webplan-client)

<br />

![Node.js](https://img.shields.io/badge/Node.js-Runtime-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-Database-47A248?style=flat-square&logo=mongodb&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![JWT](https://img.shields.io/badge/JWT-Authentication-000000?style=flat-square&logo=jsonwebtokens&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deployment-000000?style=flat-square&logo=vercel&logoColor=white)

</div>

---

## 📖 About the Project

**WedPlan Server** is the backend REST API for [WedPlan](https://webplan-gilt.vercel.app/), a wedding planning platform with three roles: customers, vendors and admins.

The server handles service management, booking requests, Stripe subscription payments, admin moderation and authentication for protected API routes.

Built with **Express.js 5** and the native MongoDB Node.js driver, the API provides endpoints for browsing and managing wedding services, submitting and processing booking requests, upgrading vendors to Premium and reviewing users, services and transactions.

Authentication is handled through JWT verification using `jose`. The client app issues the tokens with Better Auth, and this server validates them against the Better Auth JWKS endpoint, then loads the user from the database to check the role and blocked status before allowing access to protected operations.

## 🔗 Links

- **Live Application:** https://webplan-gilt.vercel.app/
- **Server Repository:** https://github.com/ABiR994/wedplan-server
- **Client Repository:** https://github.com/ABiR994/webplan-client

---

## ✨ Key Features

### 🔐 JWT Authentication and Role-Based Access

Protected API routes use JWT-based authentication.

The authentication middleware:

- Extracts the bearer token from the Authorization header.
- Verifies the token signature, issuer, audience and expiry using `jose` and the Better Auth JWKS endpoint (`<CLIENT_URL>/api/auth/jwks`).
- Loads the user from the database, so the role is never taken from the token or the request.
- Rejects missing, invalid or expired tokens with `401`.
- Rejects blocked users with `403`.

Role middleware then limits routes to **customers**, **vendors** or **admins** and returns `403` for any other role. Resource ownership is also verified before any update or deletion.

### 📚 Services

- Public listing of approved and available services with search, category and location filters, and price sorting.
- Featured services, category counts and a locations list for the home and browse pages.
- Single service details with a clear `400` for invalid IDs and `404` for missing or unavailable services.
- Vendors can add, update and delete their own services, and turn availability on or off.
- New services start as `pending` until an admin approves them. Rejected services are never returned by the public endpoints.
- Editing a rejected service sends it back to `pending` for review.

### 📦 Free Plan Limit

Free vendors can keep a maximum of **3 active services** (pending or approved, and available). The limit is checked when adding a service, resubmitting a rejected one and turning a service back on. Premium vendors have no limit.

### 📅 Booking Requests

- Customers submit booking requests with an event date, event location and message.
- The customer and vendor are set by the server, not taken from the request body.
- Only approved and available services can be booked, and customers cannot book their own services.
- Duplicate active (pending or accepted) requests for the same service and event date are rejected with `409`.
- Vendors can accept or reject only their own **pending** requests. The status change is a single atomic database update, so a request cannot be processed twice.
- Customers can cancel only their own **pending** requests.

### 💳 Stripe Subscriptions

- `POST /payments/create-checkout-session` creates a Stripe Checkout session for the logged-in vendor only. A vendor who is already Premium cannot create another one.
- Premium is activated **only after a verified Stripe webhook**. The success redirect on the client never activates anything.
- The webhook verifies Stripe's signature on the raw request body and handles three events:
  - `checkout.session.completed` saves the transaction and activates Premium.
  - `invoice.paid` extends the Premium expiry on renewal.
  - `customer.subscription.deleted` returns the vendor to the Free plan.
- Transactions are saved once per Checkout session, so repeated webhook deliveries do not create duplicates.
- Premium expires one day after the paid period ends unless it is renewed.
- Vendors can manage or cancel the subscription in the Stripe billing portal.
- There is no endpoint to create or edit payment records manually.

### 🛠️ Admin Moderation

- List and search users, filter by role, and view user details with activity counts.
- Block or unblock users. Admin accounts cannot be blocked.
- List, search and filter all services, approve or reject them, and delete inappropriate ones.
- View all transactions (read-only).

### 👤 Profile Updates

`PATCH /profile` only updates the name, the profile image and, for vendors, the business name. Any other field in the request, such as the role or subscription, is ignored.

### ✅ Input Validation

All request data is validated on the server:

- Service name 3 to 100 characters, description 20 to 2000 characters, location 2 to 100 characters.
- Category must be one of the six wedding categories.
- Price must be a positive number.
- 1 to 4 valid image URLs per service.
- Event date must be a valid date that is not in the past, event location 2 to 200 characters, message up to 1000 characters.
- Query values are treated as plain text, and search terms are escaped before they are used in a database query.

### 🚨 Error Handling

- Consistent JSON error responses with the right status codes: `400`, `401`, `403`, `404`, `409` and `500`.
- Unknown routes return a JSON `404`, and unexpected errors return a JSON `500`.

### 🌐 CORS Configuration

Cross-Origin Resource Sharing allows requests from the WedPlan frontend origin (`CLIENT_URL`).

### ☁️ Vercel Deployment

The server exports the Express app so it can run on Vercel, and it also listens on `PORT` for local development.

---

## 🛠️ Tech Stack

| Technology | Usage |
|---|---|
| Node.js | JavaScript runtime |
| Express.js 5 | REST API framework |
| MongoDB | NoSQL database |
| MongoDB Native Driver | Database operations and queries |
| jose | JWT verification and JWKS integration |
| Better Auth | Authentication and token issuer (runs in the client app) |
| Stripe | Checkout sessions, billing portal and webhooks |
| CORS | Cross-origin request configuration |
| Vercel | Server deployment |

---

## 🧭 API Routes

The server exposes 30 REST API endpoints.

### Public

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` | Server status message |
| GET | `/services` | List approved services (`q`, `category`, `location`, `sort`) |
| GET | `/services/featured` | Latest 6 approved services |
| GET | `/services/locations` | Locations of approved services |
| GET | `/services/category-counts` | Number of approved services per category |
| GET | `/services/:id` | Single approved service |
| POST | `/payments/webhook` | Stripe webhook (verified by Stripe signature) |

### Any logged-in user

| Method | Endpoint | Description |
|---|---|---|
| GET | `/overview` | Dashboard statistics for the user's role |
| PATCH | `/profile` | Update name, image and business name |

### Vendor

| Method | Endpoint | Description |
|---|---|---|
| GET | `/vendor/services` | The vendor's own services |
| POST | `/services` | Add a service |
| PATCH | `/services/:id` | Update a service (owner only) |
| PATCH | `/services/:id/availability` | Turn availability on or off (owner only) |
| DELETE | `/services/:id` | Delete a service (owner only) |
| GET | `/vendor/bookings` | Booking requests for the vendor's services |
| PATCH | `/bookings/:id/status` | Accept or reject a pending request |
| GET | `/payments/subscription` | Current plan and expiry |
| POST | `/payments/create-checkout-session` | Start Stripe Checkout |
| GET | `/payments/status` | Check whether a payment was verified |
| POST | `/payments/portal-session` | Open the Stripe billing portal |

### Customer

| Method | Endpoint | Description |
|---|---|---|
| POST | `/bookings` | Submit a booking request |
| GET | `/customer/bookings` | The customer's own bookings |
| PATCH | `/bookings/:id/cancel` | Cancel a pending booking |

### Admin

| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/users` | List users (`q`, `role`) |
| GET | `/admin/users/:id` | User details and activity |
| PATCH | `/admin/users/:id/block` | Block or unblock a user |
| GET | `/admin/services` | List all services (`q`, `status`, `category`) |
| PATCH | `/admin/services/:id/status` | Approve or reject a service |
| DELETE | `/admin/services/:id` | Delete a service |
| GET | `/admin/transactions` | List payment records |

### Authentication Header

All private endpoints require a valid JWT.

```http
Authorization: Bearer <token>
```

### Example API Requests

**Search and sort services**

```http
GET /services?q=photography&category=Wedding%20Venues&location=Dhaka&sort=price_asc
```

Supported `sort` values: `price_asc`, `price_desc`. The default is newest first.

**Add a service**

```http
POST /services
Authorization: Bearer <token>
Content-Type: application/json

{
  "serviceName": "Cinematic Wedding Photography",
  "category": "Photography & Videography",
  "description": "Full-day coverage with two photographers and an edited gallery.",
  "price": 450,
  "location": "Dhaka",
  "images": ["https://i.ibb.co/example/cover.jpg"]
}
```

**Submit a booking request**

```http
POST /bookings
Authorization: Bearer <token>
Content-Type: application/json

{
  "serviceId": "SERVICE_ID",
  "eventDate": "2027-02-14",
  "eventLocation": "Grand Hall, Dhaka",
  "message": "We expect around 200 guests."
}
```

**Accept or reject a booking request**

```http
PATCH /bookings/:id/status
Authorization: Bearer <token>
Content-Type: application/json

{
  "status": "accepted"
}
```

**Start a Premium upgrade**

```http
POST /payments/create-checkout-session
Authorization: Bearer <token>
```

The response contains the Stripe Checkout `url` to redirect the vendor to.

---

## 🗄️ Database Structure

WedPlan uses MongoDB. Better Auth manages its own collections (`user`, `session`, `account`, `verification` and `jwks`), and the server manages three business collections.

### Users (Better Auth)

Besides the standard Better Auth fields, each user document includes:

```javascript
{
  name: String,
  email: String,
  image: String,

  role: "customer" | "vendor" | "admin",
  isBlocked: Boolean,

  businessName: String,            // vendors
  subscriptionPlan: "free" | "premium",
  subscriptionExpiresAt: Date
}
```

The server also stores `stripeCustomerId` on a vendor after the first verified payment.

### Services Collection

```javascript
{
  vendorId: ObjectId,              // reference to users
  serviceName: String,
  category: String,
  description: String,
  price: Number,
  location: String,
  images: [String],

  status: "pending" | "approved" | "rejected",
  isActive: Boolean,               // vendor availability

  createdAt: Date
}
```

### Bookings Collection

```javascript
{
  serviceId: ObjectId,             // reference to services
  vendorId: ObjectId,              // reference to users
  customerId: ObjectId,            // reference to users

  eventDate: String,               // YYYY-MM-DD
  eventLocation: String,
  message: String,

  status: "pending" | "accepted" | "rejected" | "cancelled",

  createdAt: Date
}
```

### Transactions Collection

```javascript
{
  vendorId: ObjectId,              // reference to users
  plan: String,
  amount: Number,
  currency: String,

  stripeSessionId: String,
  stripeSubscriptionId: String,

  status: String,

  createdAt: Date
}
```

---

## 📂 Project Structure

```text
wedplan-server/
│
├── index.js
│
├── .env.example
├── .gitignore
├── package.json
└── package-lock.json
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or later.
- npm.
- A [MongoDB Atlas](https://www.mongodb.com/atlas) cluster.
- A [Stripe](https://stripe.com/) account in test mode and the [Stripe CLI](https://docs.stripe.com/stripe-cli).
- The WedPlan client running with Better Auth configured ([webplan-client](https://github.com/ABiR994/webplan-client)).

### Installation

Clone the repository:

```bash
git clone https://github.com/ABiR994/wedplan-server.git
cd wedplan-server
```

Install dependencies:

```bash
npm install
```

Create an environment file:

```bash
cp .env.example .env
```

Configure the required environment variables.

### Environment Variables

Add the following variables to your `.env` file:

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string (legacy `mongodb://` format). Use the same database as the client |
| `CLIENT_URL` | Frontend origin used for CORS, Stripe redirect URLs and JWT verification (no trailing slash). It must match the client's `BETTER_AUTH_URL` |
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `PORT` | Local server port (default: `5000`, not needed on Vercel) |

> **Important:** `.env` files are never committed to GitHub. Keep all secrets in environment variables.

### Set Up Stripe Locally

1. In the Stripe dashboard (test mode), copy the secret key into `STRIPE_SECRET_KEY`.
2. Log in with the Stripe CLI:

```bash
stripe login
```

3. Forward webhook events to your local server:

```bash
stripe listen --forward-to localhost:5000/payments/webhook
```

4. Copy the `whsec_...` secret printed by the CLI into `STRIPE_WEBHOOK_SECRET`.
5. In Stripe, open Settings, then Billing, then Customer portal, and activate the portal so vendors can manage their subscription.

### How to Run the Project Locally

```bash
npm run dev
```

The server runs at:

```text
http://localhost:5000
```

Open the root route to check that the server is running:

```text
http://localhost:5000/
```

Start the production version with:

```bash
npm start
```

---

## ☁️ Deployment

The backend is configured for deployment on **Vercel**.

When deploying your own copy:

1. Import the server repository into Vercel.
2. Configure the required environment variables in the Vercel project settings.
3. Set `MONGODB_URI` to your MongoDB Atlas connection string.
4. Set `CLIENT_URL` to your deployed frontend URL, the same value as the client's `BETTER_AUTH_URL`.
5. Add `STRIPE_SECRET_KEY` with your Stripe test secret key.
6. In the Stripe dashboard, go to Developers, then Webhooks, and add the endpoint `https://<your-server-url>/payments/webhook` with these events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `customer.subscription.deleted`
7. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
8. Make sure MongoDB Atlas allows connections from the deployed backend (Network Access).
9. Deploy the application and open the root route to verify it.

Redeploy after changing environment variables. The frontend communicates with this backend through its `NEXT_PUBLIC_API_URL`.

---

## 🔗 Related Project

### WedPlan Client

The frontend is built separately using Next.js, React, TypeScript and Tailwind CSS.

- [View Client Repository](https://github.com/ABiR994/webplan-client)
- [Visit Live Application](https://webplan-gilt.vercel.app/)

---

## 👨‍💻 Author

**Salem Nur Abir**

CSE Student | Aspiring Software Engineer

[![GitHub](https://img.shields.io/badge/GitHub-ABiR994-181717?style=for-the-badge&logo=github)](https://github.com/ABiR994)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Salem%20Nur%20Abir-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://linkedin.com/in/salem-nur-abir/)
[![Portfolio](https://img.shields.io/badge/Portfolio-Visit%20Website-15803d?style=for-the-badge&logo=vercel&logoColor=white)](https://abir994.pro.bd/)
