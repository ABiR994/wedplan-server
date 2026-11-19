import "dotenv/config"
import { MongoClient } from "mongodb"

const SERVICES = [
  ["Cinematic Wedding Photography", "Photography & Videography", 450, "Dhaka", "photography", "Full-day coverage with two photographers, a highlight film and an edited online gallery."],
  ["Wedding Film & Drone Coverage", "Photography & Videography", 700, "Chattogram", "photography", "Cinematic wedding film with aerial drone shots and a same-week teaser."],
  ["Garden Lawn Wedding Venue", "Wedding Venues", 1800, "Dhaka", "venues", "Open-air lawn for up to 400 guests with a covered stage and bridal suite."],
  ["Lakeside Banquet Hall", "Wedding Venues", 2400, "Sylhet", "venues", "Air-conditioned banquet hall with lake views, parking and an in-house events team."],
  ["Floral Stage & Mandap Decor", "Decoration & Florist", 650, "Dhaka", "decoration", "Custom stage, entrance and table decor using fresh seasonal flowers."],
  ["Fairy Light Reception Styling", "Decoration & Florist", 520, "Rajshahi", "decoration", "Warm fairy lights, draped fabrics and centerpieces for evening receptions."],
  ["Traditional Feast Catering", "Catering Services", 15, "Dhaka", "catering", "Per-guest multi-course menu with live counters, service staff and cleanup."],
  ["Premium Buffet & Dessert Bar", "Catering Services", 22, "Khulna", "catering", "International buffet with a dessert bar and a custom wedding cake."],
  ["Bridal Makeup & Hair", "Makeup & Styling", 220, "Dhaka", "makeup", "Bridal makeup, hair styling and draping with a trial session included."],
  ["Mehndi & Party Glam Package", "Makeup & Styling", 150, "Chattogram", "makeup", "Makeup and styling for the bride and two family members on the same day."],
  ["Custom Bridal Lehenga Design", "Wedding Fashion", 900, "Dhaka", "fashion", "Made-to-measure bridal outfits with hand embroidery and two fittings."],
  ["Groom Sherwani & Accessories", "Wedding Fashion", 380, "Sylhet", "fashion", "Tailored sherwani with turban, shoes and accessories to match."],
]

const client = new MongoClient(process.env.MONGODB_URI)

try {
  await client.connect()
  const database = client.db("wedplandb")

  const vendors = await database
    .collection("user")
    .find({ role: "vendor" })
    .toArray()

  if (vendors.length === 0) {
    console.log("No vendor found. Sign up a vendor account first.")
    process.exit(1)
  }

  const services = database.collection("services")

  for (const [index, item] of SERVICES.entries()) {
    const [serviceName, category, price, location, image, description] = item
    const vendor = vendors[index % vendors.length]

    await services.updateOne(
      { serviceName },
      {
        $setOnInsert: {
          vendorId: vendor._id,
          serviceName,
          category,
          description,
          price,
          location,
          images: [
            `/images/services/${image}-1.svg`,
            `/images/services/${image}-2.svg`,
          ],
          status: "approved",
          isActive: true,
          createdAt: new Date(Date.now() - index * 60000),
        },
      },
      { upsert: true }
    )
  }

  console.log(`Seeded ${SERVICES.length} services`)
} finally {
  await client.close()
}
