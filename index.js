import express from "express"
import cors from "cors"
import "dotenv/config"
import { MongoClient, ObjectId } from "mongodb"
import { createRemoteJWKSet, jwtVerify } from "jose"
import Stripe from "stripe"

const app = express()
const port = process.env.PORT || 5000
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
)

app.use(express.json())
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }))

const client = new MongoClient(process.env.MONGODB_URI)

async function connectToMongoDB() {
  try {
    await client.connect()
    console.log("Connected to MongoDB")
    return client
  } catch (err) {
    console.dir(err)
  }
}

const connectedClient = await connectToMongoDB()
const database = connectedClient.db("wedplandb")
const usersCollection = database.collection("user")
const servicesCollection = database.collection("services")
const bookingsCollection = database.collection("bookings")
const transactionsCollection = database.collection("transactions")

const publicServiceFilter = { status: "approved", isActive: true }

const CATEGORIES = [
  "Photography & Videography",
  "Wedding Venues",
  "Decoration & Florist",
  "Catering Services",
  "Makeup & Styling",
  "Wedding Fashion",
]

const FREE_PLAN_LIMIT = 3
const PREMIUM_PRICE_USD = 19
const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000

const jwks = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`)
)

const verifyToken = async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization ?? "").split(" ")
  if (scheme !== "Bearer" || !token) {
    return res.status(401).send({ message: "Unauthorized" })
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.CLIENT_URL,
      audience: process.env.CLIENT_URL,
    })
    const user = await usersCollection.findOne({
      _id: new ObjectId(payload.sub),
    })

    if (!user) return res.status(401).send({ message: "Unauthorized" })
    if (user.isBlocked) {
      return res.status(403).send({ message: "Your account is blocked" })
    }

    req.user = user
    next()
  } catch {
    res.status(401).send({ message: "Invalid or expired token" })
  }
}

const verifyRole = (role) => (req, res, next) => {
  if (req.user.role !== role) {
    return res.status(403).send({ message: "Forbidden" })
  }
  next()
}

const verifyCustomer = verifyRole("customer")
const verifyVendor = verifyRole("vendor")
const verifyAdmin = verifyRole("admin")

const isPremium = (user) =>
  user.subscriptionPlan === "premium" &&
  (!user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt) > new Date())

app.get("/", (req, res) => {
  res.send("WedPlan server is running")
})

const SORTS = {
  price_asc: { price: 1, createdAt: -1 },
  price_desc: { price: -1, createdAt: -1 },
}

const isObjectId = (value) =>
  ObjectId.isValid(value) && String(new ObjectId(value)) === value

const asText = (value) => (typeof value === "string" ? value.trim() : "")
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const vendorStages = [
  {
    $lookup: {
      from: "user",
      localField: "vendorId",
      foreignField: "_id",
      as: "vendor",
    },
  },
  { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
]

const vendorFields = {
  "vendor.name": 1,
  "vendor.businessName": 1,
  "vendor.image": 1,
  "vendor.subscriptionPlan": 1,
}

const cardFields = {
  serviceName: 1,
  category: 1,
  price: 1,
  location: 1,
  images: 1,
  ...vendorFields,
}

const getServices = (filter, sort, limit) => {
  const pipeline = [{ $match: filter }, { $sort: sort }]
  if (limit) pipeline.push({ $limit: limit })
  pipeline.push(...vendorStages, { $project: cardFields })

  return servicesCollection.aggregate(pipeline).toArray()
}

app.get("/overview", verifyToken, async (req, res) => {
  const { _id, role } = req.user

  if (role === "vendor") {
    const [totalServices, activeServices, pendingRequests, acceptedBookings] =
      await Promise.all([
        servicesCollection.countDocuments({ vendorId: _id }),
        servicesCollection.countDocuments({ vendorId: _id, ...publicServiceFilter }),
        bookingsCollection.countDocuments({ vendorId: _id, status: "pending" }),
        bookingsCollection.countDocuments({ vendorId: _id, status: "accepted" }),
      ])

    return res.send({
      totalServices,
      activeServices,
      pendingRequests,
      acceptedBookings,
      plan: isPremium(req.user) ? "premium" : "free",
    })
  }

  if (role === "customer") {
    const [totalBookings, pending, accepted, rejected] = await Promise.all([
      bookingsCollection.countDocuments({ customerId: _id }),
      bookingsCollection.countDocuments({ customerId: _id, status: "pending" }),
      bookingsCollection.countDocuments({ customerId: _id, status: "accepted" }),
      bookingsCollection.countDocuments({ customerId: _id, status: "rejected" }),
    ])

    return res.send({ totalBookings, pending, accepted, rejected })
  }

  const [
    totalUsers,
    totalVendors,
    totalCustomers,
    totalServices,
    pendingServices,
    totalTransactions,
  ] = await Promise.all([
    usersCollection.countDocuments({}),
    usersCollection.countDocuments({ role: "vendor" }),
    usersCollection.countDocuments({ role: "customer" }),
    servicesCollection.countDocuments({}),
    servicesCollection.countDocuments({ status: "pending" }),
    transactionsCollection.countDocuments({}),
  ])

  res.send({
    totalUsers,
    totalVendors,
    totalCustomers,
    totalServices,
    pendingServices,
    totalTransactions,
  })
})

app.patch("/profile", verifyToken, async (req, res) => {
  const name = asText(req.body.name)
  const image = asText(req.body.image)
  const businessName = asText(req.body.businessName)

  if (name.length < 2 || name.length > 80) {
    return res.status(400).send({ message: "Name must be 2 to 80 characters" })
  }
  if (businessName.length > 100) {
    return res
      .status(400)
      .send({ message: "Business name must be 100 characters or fewer" })
  }
  if (image) {
    try {
      if (new URL(image).protocol !== "https:") throw new Error()
    } catch {
      return res.status(400).send({ message: "Invalid image URL" })
    }
  }

  const updates = { name, updatedAt: new Date() }
  if (image) updates.image = image
  if (req.user.role === "vendor") updates.businessName = businessName

  await usersCollection.updateOne({ _id: req.user._id }, { $set: updates })

  res.send({ message: "Profile updated successfully" })
})

app.get("/services", async (req, res) => {
  const search = asText(req.query.q)
  const category = asText(req.query.category)
  const location = asText(req.query.location)
  const sortKey = asText(req.query.sort)

  const filter = { ...publicServiceFilter }
  if (search) {
    filter.serviceName = { $regex: escapeRegex(search), $options: "i" }
  }
  if (category) filter.category = category
  if (location) filter.location = location

  const sort = Object.hasOwn(SORTS, sortKey)
    ? SORTS[sortKey]
    : { createdAt: -1 }

  res.send(await getServices(filter, sort))
})

app.get("/services/featured", async (req, res) => {
  res.send(await getServices(publicServiceFilter, { createdAt: -1 }, 6))
})

app.get("/services/locations", async (req, res) => {
  const locations = await servicesCollection.distinct(
    "location",
    publicServiceFilter
  )

  res.send(locations.sort())
})

app.get("/services/category-counts", async (req, res) => {
  const counts = await servicesCollection
    .aggregate([
      { $match: publicServiceFilter },
      { $group: { _id: "$category", count: { $sum: 1 } } },
    ])
    .toArray()

  res.send(counts)
})

app.get("/services/:id", async (req, res) => {
  const { id } = req.params
  if (!isObjectId(id)) {
    return res.status(400).send({ message: "Invalid service ID" })
  }

  const [service] = await servicesCollection
    .aggregate([
      { $match: { _id: new ObjectId(id), ...publicServiceFilter } },
      ...vendorStages,
      {
        $project: {
          ...cardFields,
          description: 1,
          vendorId: 1,
          createdAt: 1,
        },
      },
    ])
    .toArray()

  if (!service) {
    return res
      .status(404)
      .send({ message: "Service not found or no longer available" })
  }

  res.send(service)
})

const isValidImage = (image) => {
  if (typeof image !== "string") return false
  if (image.startsWith("/images/")) return true
  try {
    return new URL(image).protocol === "https:"
  } catch {
    return false
  }
}

const validateService = (body) => {
  const serviceName = asText(body.serviceName)
  const category = asText(body.category)
  const description = asText(body.description)
  const location = asText(body.location)
  const price = Number(body.price)
  const images = Array.isArray(body.images) ? body.images : []

  if (serviceName.length < 3 || serviceName.length > 100) {
    return { error: "Service name must be 3 to 100 characters" }
  }
  if (!CATEGORIES.includes(category)) {
    return { error: "Please select a valid category" }
  }
  if (description.length < 20 || description.length > 2000) {
    return { error: "Description must be 20 to 2000 characters" }
  }
  if (!Number.isFinite(price) || price <= 0 || price > 1000000) {
    return { error: "Please enter a valid price" }
  }
  if (location.length < 2 || location.length > 100) {
    return { error: "Location must be 2 to 100 characters" }
  }
  if (images.length < 1 || images.length > 4 || !images.every(isValidImage)) {
    return { error: "Please provide 1 to 4 valid service images" }
  }

  return {
    data: { serviceName, category, description, price, location, images },
  }
}

const countActiveServices = (vendorId, excludeId) =>
  servicesCollection.countDocuments({
    vendorId,
    isActive: true,
    status: { $in: ["pending", "approved"] },
    ...(excludeId && { _id: { $ne: excludeId } }),
  })

const freePlanLimitMessage = `Free plan allows up to ${FREE_PLAN_LIMIT} active services. Upgrade to Premium to add more.`

const getOwnedService = async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(400).send({ message: "Invalid service ID" })
    return null
  }

  const service = await servicesCollection.findOne({
    _id: new ObjectId(req.params.id),
    vendorId: req.user._id,
  })
  if (!service) {
    res.status(404).send({ message: "Service not found" })
    return null
  }
  return service
}

app.get("/vendor/services", verifyToken, verifyVendor, async (req, res) => {
  const services = await servicesCollection
    .find({ vendorId: req.user._id })
    .sort({ createdAt: -1 })
    .toArray()

  res.send(services)
})

app.post("/services", verifyToken, verifyVendor, async (req, res) => {
  const { error, data } = validateService(req.body)
  if (error) return res.status(400).send({ message: error })

  if (!isPremium(req.user)) {
    if ((await countActiveServices(req.user._id)) >= FREE_PLAN_LIMIT) {
      return res.status(403).send({ message: freePlanLimitMessage })
    }
  }

  const service = {
    vendorId: req.user._id,
    ...data,
    status: "pending",
    isActive: true,
    createdAt: new Date(),
  }
  const result = await servicesCollection.insertOne(service)

  res.status(201).send({ _id: result.insertedId, ...service })
})

app.patch("/services/:id", verifyToken, verifyVendor, async (req, res) => {
  const service = await getOwnedService(req, res)
  if (!service) return

  const { error, data } = validateService(req.body)
  if (error) return res.status(400).send({ message: error })

  const updates = { ...data, updatedAt: new Date() }

  if (service.status === "rejected") {
    const needsSlot = service.isActive && !isPremium(req.user)
    if (
      needsSlot &&
      (await countActiveServices(req.user._id, service._id)) >= FREE_PLAN_LIMIT
    ) {
      return res.status(403).send({ message: freePlanLimitMessage })
    }
    updates.status = "pending"
  }

  await servicesCollection.updateOne({ _id: service._id }, { $set: updates })

  res.send({ ...service, ...updates })
})

app.patch(
  "/services/:id/availability",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    const service = await getOwnedService(req, res)
    if (!service) return

    const { isActive } = req.body
    if (typeof isActive !== "boolean") {
      return res.status(400).send({ message: "isActive must be true or false" })
    }

    const needsSlot =
      isActive &&
      !service.isActive &&
      service.status !== "rejected" &&
      !isPremium(req.user)
    if (
      needsSlot &&
      (await countActiveServices(req.user._id, service._id)) >= FREE_PLAN_LIMIT
    ) {
      return res.status(403).send({ message: freePlanLimitMessage })
    }

    await servicesCollection.updateOne(
      { _id: service._id },
      { $set: { isActive, updatedAt: new Date() } }
    )

    res.send({ isActive })
  }
)

app.delete("/services/:id", verifyToken, verifyVendor, async (req, res) => {
  const service = await getOwnedService(req, res)
  if (!service) return

  await servicesCollection.deleteOne({ _id: service._id })

  res.send({ message: "Service deleted successfully" })
})

app.post("/bookings", verifyToken, verifyCustomer, async (req, res) => {
  const serviceId = asText(req.body.serviceId)
  const eventDate = asText(req.body.eventDate)
  const eventLocation = asText(req.body.eventLocation)
  const message = asText(req.body.message)

  if (!isObjectId(serviceId)) {
    return res.status(400).send({ message: "Invalid service ID" })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(eventDate))) {
    return res.status(400).send({ message: "Please provide a valid event date" })
  }
  if (eventDate < new Date().toISOString().slice(0, 10)) {
    return res.status(400).send({ message: "Event date cannot be in the past" })
  }
  if (eventLocation.length < 2 || eventLocation.length > 200) {
    return res
      .status(400)
      .send({ message: "Event location must be 2 to 200 characters" })
  }
  if (message.length > 1000) {
    return res
      .status(400)
      .send({ message: "Message must be 1000 characters or fewer" })
  }

  const service = await servicesCollection.findOne({
    _id: new ObjectId(serviceId),
    ...publicServiceFilter,
  })
  if (!service) {
    return res
      .status(404)
      .send({ message: "Service not found or no longer available" })
  }
  if (String(service.vendorId) === String(req.user._id)) {
    return res
      .status(403)
      .send({ message: "You cannot book your own service" })
  }

  const duplicate = await bookingsCollection.findOne({
    serviceId: service._id,
    customerId: req.user._id,
    eventDate,
    status: { $in: ["pending", "accepted"] },
  })
  if (duplicate) {
    return res.status(409).send({
      message: "You already have an active request for this service on that date",
    })
  }

  const booking = {
    serviceId: service._id,
    vendorId: service.vendorId,
    customerId: req.user._id,
    eventDate,
    eventLocation,
    message,
    status: "pending",
    createdAt: new Date(),
  }
  const result = await bookingsCollection.insertOne(booking)

  res.status(201).send({ _id: result.insertedId, ...booking })
})

app.get("/vendor/bookings", verifyToken, verifyVendor, async (req, res) => {
  const bookings = await bookingsCollection
    .aggregate([
      { $match: { vendorId: req.user._id } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "user",
          localField: "customerId",
          foreignField: "_id",
          as: "customer",
        },
      },
      {
        $lookup: {
          from: "services",
          localField: "serviceId",
          foreignField: "_id",
          as: "service",
        },
      },
      { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          eventDate: 1,
          eventLocation: 1,
          message: 1,
          status: 1,
          createdAt: 1,
          "customer.name": 1,
          "customer.email": 1,
          "customer.image": 1,
          "service.serviceName": 1,
          "service.category": 1,
          "service.images": 1,
        },
      },
    ])
    .toArray()

  res.send(bookings)
})

app.patch(
  "/bookings/:id/status",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    if (!isObjectId(req.params.id)) {
      return res.status(400).send({ message: "Invalid booking ID" })
    }

    const status = asText(req.body.status)
    if (!["accepted", "rejected"].includes(status)) {
      return res
        .status(400)
        .send({ message: "Status must be accepted or rejected" })
    }

    const filter = { _id: new ObjectId(req.params.id), vendorId: req.user._id }
    const updated = await bookingsCollection.findOneAndUpdate(
      { ...filter, status: "pending" },
      { $set: { status, updatedAt: new Date() } }
    )
    if (updated) return res.send({ status })

    const booking = await bookingsCollection.findOne(filter)
    if (!booking) {
      return res.status(404).send({ message: "Booking request not found" })
    }
    res.status(409).send({
      message: `This request is already ${booking.status} and cannot be changed`,
    })
  }
)

app.get("/customer/bookings", verifyToken, verifyCustomer, async (req, res) => {
  const bookings = await bookingsCollection
    .aggregate([
      { $match: { customerId: req.user._id } },
      { $sort: { createdAt: -1 } },
      {
        $lookup: {
          from: "services",
          localField: "serviceId",
          foreignField: "_id",
          as: "service",
        },
      },
      {
        $lookup: {
          from: "user",
          localField: "vendorId",
          foreignField: "_id",
          as: "vendor",
        },
      },
      { $unwind: { path: "$service", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$vendor", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          serviceId: 1,
          eventDate: 1,
          eventLocation: 1,
          message: 1,
          status: 1,
          createdAt: 1,
          "service.serviceName": 1,
          "service.category": 1,
          "service.images": 1,
          "service.price": 1,
          "service.location": 1,
          "vendor.name": 1,
          "vendor.businessName": 1,
          "vendor.image": 1,
        },
      },
    ])
    .toArray()

  res.send(bookings)
})

app.patch(
  "/bookings/:id/cancel",
  verifyToken,
  verifyCustomer,
  async (req, res) => {
    if (!isObjectId(req.params.id)) {
      return res.status(400).send({ message: "Invalid booking ID" })
    }

    const filter = {
      _id: new ObjectId(req.params.id),
      customerId: req.user._id,
    }
    const updated = await bookingsCollection.findOneAndUpdate(
      { ...filter, status: "pending" },
      { $set: { status: "cancelled", updatedAt: new Date() } }
    )
    if (updated) return res.send({ status: "cancelled" })

    const booking = await bookingsCollection.findOne(filter)
    if (!booking) {
      return res.status(404).send({ message: "Booking not found" })
    }
    res.status(409).send({
      message: `This booking is already ${booking.status} and cannot be cancelled`,
    })
  }
)

const getPeriodEnd = (subscription) => {
  const end =
    subscription.items?.data?.[0]?.current_period_end ??
    subscription.current_period_end

  return new Date(end * 1000 + GRACE_PERIOD_MS)
}

async function activatePremium(session) {
  const vendorId = session.metadata?.vendorId
  if (
    session.mode !== "subscription" ||
    session.payment_status !== "paid" ||
    !isObjectId(vendorId)
  ) {
    return
  }

  const subscription = await stripe.subscriptions.retrieve(session.subscription)

  await transactionsCollection.updateOne(
    { stripeSessionId: session.id },
    {
      $setOnInsert: {
        vendorId: new ObjectId(vendorId),
        plan: "premium",
        amount: session.amount_total / 100,
        currency: session.currency,
        stripeSessionId: session.id,
        stripeSubscriptionId: session.subscription,
        status: "paid",
        createdAt: new Date(),
      },
    },
    { upsert: true }
  )

  await usersCollection.updateOne(
    { _id: new ObjectId(vendorId), role: "vendor" },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: getPeriodEnd(subscription),
        stripeCustomerId: session.customer,
      },
    }
  )
}

async function renewPremium(invoice) {
  const subscriptionId =
    invoice.parent?.subscription_details?.subscription ?? invoice.subscription
  if (invoice.billing_reason !== "subscription_cycle" || !subscriptionId) return

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const vendorId = subscription.metadata?.vendorId
  if (!isObjectId(vendorId)) return

  await usersCollection.updateOne(
    { _id: new ObjectId(vendorId), role: "vendor" },
    {
      $set: {
        subscriptionPlan: "premium",
        subscriptionExpiresAt: getPeriodEnd(subscription),
      },
    }
  )
}

async function cancelPremium(subscription) {
  const vendorId = subscription.metadata?.vendorId
  if (!isObjectId(vendorId)) return

  await usersCollection.updateOne(
    { _id: new ObjectId(vendorId), role: "vendor" },
    { $set: { subscriptionPlan: "free" }, $unset: { subscriptionExpiresAt: "" } }
  )
}

async function handleStripeWebhook(req, res) {
  let event
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    )
  } catch {
    return res.status(400).send({ message: "Invalid webhook signature" })
  }

  try {
    if (event.type === "checkout.session.completed") {
      await activatePremium(event.data.object)
    } else if (event.type === "invoice.paid") {
      await renewPremium(event.data.object)
    } else if (event.type === "customer.subscription.deleted") {
      await cancelPremium(event.data.object)
    }
  } catch (error) {
    console.error(error)
    return res.status(500).send({ message: "Webhook handling failed" })
  }

  res.send({ received: true })
}

app.get("/payments/subscription", verifyToken, verifyVendor, (req, res) => {
  res.send({
    plan: isPremium(req.user) ? "premium" : "free",
    expiresAt: req.user.subscriptionExpiresAt ?? null,
    canManage: Boolean(req.user.stripeCustomerId),
  })
})

app.post(
  "/payments/create-checkout-session",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    if (isPremium(req.user)) {
      return res
        .status(409)
        .send({ message: "You already have an active Premium subscription" })
    }

    const vendorId = String(req.user._id)
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      ...(req.user.stripeCustomerId
        ? { customer: req.user.stripeCustomerId }
        : { customer_email: req.user.email }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: PREMIUM_PRICE_USD * 100,
            recurring: { interval: "month" },
            product_data: {
              name: "WedPlan Premium",
              description: "Unlimited services and the Premium Vendor badge",
            },
          },
        },
      ],
      client_reference_id: vendorId,
      metadata: { vendorId },
      subscription_data: { metadata: { vendorId } },
      success_url: `${process.env.CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/payment/cancel`,
    })

    res.send({ url: session.url })
  }
)

app.get("/payments/status", verifyToken, verifyVendor, async (req, res) => {
  const sessionId = asText(req.query.session_id)
  if (!sessionId) {
    return res.status(400).send({ message: "Session ID is required" })
  }

  const transaction = await transactionsCollection.findOne({
    stripeSessionId: sessionId,
    vendorId: req.user._id,
  })

  res.send({ status: transaction ? "paid" : "pending" })
})

app.post(
  "/payments/portal-session",
  verifyToken,
  verifyVendor,
  async (req, res) => {
    if (!req.user.stripeCustomerId) {
      return res.status(400).send({ message: "No billing account found" })
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripeCustomerId,
      return_url: `${process.env.CLIENT_URL}/dashboard/vendor/subscription`,
    })

    res.send({ url: session.url })
  }
)

const ROLES = ["customer", "vendor", "admin"]

const userFields = {
  name: 1,
  email: 1,
  image: 1,
  role: 1,
  isBlocked: 1,
  businessName: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
}

app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
  const search = asText(req.query.q)
  const role = asText(req.query.role)

  const filter = {}
  if (ROLES.includes(role)) filter.role = role
  if (search) {
    const pattern = { $regex: escapeRegex(search), $options: "i" }
    filter.$or = [{ name: pattern }, { email: pattern }]
  }

  const users = await usersCollection
    .find(filter, { projection: userFields })
    .sort({ createdAt: -1 })
    .limit(200)
    .toArray()

  res.send(users)
})

app.get("/admin/users/:id", verifyToken, verifyAdmin, async (req, res) => {
  if (!isObjectId(req.params.id)) {
    return res.status(400).send({ message: "Invalid user ID" })
  }

  const user = await usersCollection.findOne(
    { _id: new ObjectId(req.params.id) },
    { projection: userFields }
  )
  if (!user) return res.status(404).send({ message: "User not found" })

  const stats = {}
  if (user.role === "vendor") {
    stats.totalServices = await servicesCollection.countDocuments({
      vendorId: user._id,
    })
    stats.totalBookingRequests = await bookingsCollection.countDocuments({
      vendorId: user._id,
    })
  }
  if (user.role === "customer") {
    stats.totalBookings = await bookingsCollection.countDocuments({
      customerId: user._id,
    })
  }

  res.send({ ...user, stats })
})

app.patch(
  "/admin/users/:id/block",
  verifyToken,
  verifyAdmin,
  async (req, res) => {
    if (!isObjectId(req.params.id)) {
      return res.status(400).send({ message: "Invalid user ID" })
    }

    const { isBlocked } = req.body
    if (typeof isBlocked !== "boolean") {
      return res.status(400).send({ message: "isBlocked must be true or false" })
    }

    const user = await usersCollection.findOne({
      _id: new ObjectId(req.params.id),
    })
    if (!user) return res.status(404).send({ message: "User not found" })
    if (user.role === "admin") {
      return res.status(403).send({ message: "Admin accounts cannot be blocked" })
    }

    await usersCollection.updateOne(
      { _id: user._id },
      { $set: { isBlocked, updatedAt: new Date() } }
    )

    res.send({ isBlocked })
  }
)

app.use((req, res) => {
  res.status(404).send({ message: "Route not found" })
})

app.use((err, req, res, next) => {
  console.error(err)
  res.status(500).send({ message: "Something went wrong" })
})

app.listen(port, () => {
  console.log(`WedPlan server is running on port ${port}`)
})

export default app
