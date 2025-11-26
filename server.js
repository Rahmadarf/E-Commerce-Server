import express, { json } from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import multer from "multer";
import { createClient } from '@supabase/supabase-js'

dotenv.config();
const app = express();

app.use(cors());
app.use(express.json());

const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
)

const PORT = process.env.PORT || 3001

const SECRET_KEY = process.env.JWT_SECRET;
console.log(SECRET_KEY)

// Login endpoint
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    const { data: user, error } = await supabase
        .from('User')
        .select('*')
        .eq('email', email)
        .maybeSingle()

    if (error) {
        return res.status(500).json({ message: "Database error!" })
    }

    // cek sederhana
    if (!user) {
        return res.status(404).json({ message: "Email Not Registered" });
    }

    if (user.password !== password) return res.status(401).json({ message: "Wrong Password!" })

    // buat token
    const token = jwt.sign(
        { id: user.id, email: user.email, user: user.nama_lengkap },
        SECRET_KEY,
        { expiresIn: "1h" }
    );

    res.json({
        message: "Login Successfully",
        token: token,
        user: {
            id: user.id,
            name: user.nama_lengkap,
            email: user.email
        },
    });
});

//register Endpoint
app.post('/register', async (req, res) => {
    const { email, name, password } = req.body

    const { data: existingUser, error: errorCheck } = await supabase
        .from('User')
        .select('*')
        .eq('email', email)
        .maybeSingle()

    if (errorCheck) {
        return res.status(500).json({ message: 'Error Checking Email' })
    }

    if (existingUser) {
        return res.status(409).json({ message: 'Email Registered!' })
    }

    const { data: user, error: insertError } = await supabase
        .from('User')
        .insert([
            {
                email: email,
                nama_lengkap: name,
                password: password
            }
        ])
        .select()
        .single()

    if (insertError) {
        return res.status(500).json({ message: 'Error Inserting New User' })
    }

    const token = jwt.sign(
        { id: user.id, email: user.email, user: user.nama_lengkap },
        SECRET_KEY,
        { expiresIn: "1h" }
    );

    res.json({
        message: "Register Successfully",
        token: token,
        user: {
            id: user.id,
            name: user.nama_lengkap,
            email: user.email
        },
    });
})



// Protected route
app.get("/profile", (req, res) => {
    const token = req.headers["authorization"]?.split(" ")[1];

    if (!token) return res.status(403).json({ message: "Token missing" });

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ message: "Invalid token" });

        res.json({ message: "Welcome!", user: decoded });
    });
});



//add produk
app.post('/add-produk', upload.single('file'), async (req, res) => {
    try {
        const file = req.file
        const body = req.body

        console.log("REQ BODY:", body)
        console.log("REQ FILE:", file)

        // Jika tidak ada gambar
        if (!file) {
            return res.status(400).json({ message: "No file uploaded" })
        }

        // Nama file unik
        const fileName = `${Date.now()}_${file.originalname}`

        // Upload ke Supabase Storage
        const { error: uploadError } = await supabase.storage
            .from('image')       // ganti jika bucket kamu beda
            .upload(fileName, file.buffer, {
                contentType: file.mimetype
            })

        if (uploadError) {
            console.error(uploadError)
            return res.status(500).json({ message: uploadError.message })
        }

        // Get Public URL
        const { data: publicUrlData } = supabase.storage
            .from('image')
            .getPublicUrl(fileName)

        const publicUrl = publicUrlData.publicUrl

        // Insert ke tabel produk
        const { error: insertError } = await supabase.from('produk').insert({
            name: body.name,
            price: body.price,
            image: publicUrl,
            reviews: body.review,
            rating: body.rating,
            category: body.category,
            stock: body.stock,
            delivery: body.delivery,
            originalPrice: body.originalPrice
        })

        if (insertError) {
            console.error(insertError)
            return res.status(500).json({ message: insertError.message })
        }

        res.json({
            message: "Produk added successfully",
            image: publicUrl
        })

    } catch (err) {
        console.error(err)
        res.status(500).json({ message: "Server error", error: err.message })
    }
})


//ambil produk
app.get('/produk', async (req, res) => {
    const { data, error } = await supabase
        .from('produk')
        .select('*')

    if (error) {
        return res.status(500).json({ error: error.message })
    }

    res.json({
        message: 'Successfull',
        data
    })
})


//delete produk
app.delete('/delete-produk/:id', async (req, res) => {
    const { id } = req.params

    await supabase
        .from('cart')
        .delete()
        .eq('produkId', id)

    const { data, error } = await supabase
        .from('produk')
        .delete()
        .eq('id', id,)

    if (error) return res.status(500).json({ message: error.message })

    res.json({
        message: `Deleted ${data}`
    })
})


//add to cart endpoint
app.post('/add-cart', async (req, res) => {
    const { userId, produkId, quantity } = req.body

    const { data: existing, error: checkError } = await supabase
        .from('cart')
        .select('*')
        .eq('userId', userId)
        .eq('produkId', produkId)
        .single()

    if (checkError && checkError.code !== 'PGRST116') {
        return res.status(500).json({ message: checkError.message })
    }

    if (existing) {
        const newQty = existing.quantity + quantity

        const { data, error } = await supabase
            .from('cart')
            .update({ quantity: newQty })
            .eq('id', existing.id)
            .select()

        if (error) {
            return res.status(500).json({ message: error.message })
        }

        return res.json({
            message: `Qty updated ${data}`
        })
    }

    const { data: addedCart, error } = await supabase
        .from('cart')
        .insert([{
            userId: userId,
            produkId: produkId,
            quantity: quantity
        }])
        .select()

    if (error) {
        return res.status(500).json({ error: error.message })
    }


    res.json({
        message: 'successfull add to cart', addedCart
    })

})


//load Cart perUser
app.get('/cart/:userId', async (req, res) => {
    const userId = req.params.userId

    const { data, error } = await supabase
        .from('cart')
        .select('*, produk(*)')
        .eq('userId', userId)
        .order('id', { ascending: true })

    if (error) {
        return res.status(500).json({ message: error.message })
    }

    res.json({
        data
    })
})


//update Quantity
app.put('/update-cart', async (req, res) => {
    const { cartId, quantity } = req.body

    const { data, error } = await supabase
        .from('cart')
        .update({ quantity })
        .eq('id', cartId)
        .select()

    if (error) {
        return res.status(500).json({ message: error.message })
    }

    if (quantity == 0) {
        const { data, error } = await supabase
            .from('cart')
            .delete({ cartId })
            .select()
    }

    res.json({ message: 'Quantity updated' + data })
})


//delete Cart
app.delete('/delete-cart/:id', async (req, res) => {
    const { id } = req.params

    const { data, error } = await supabase
        .from('cart')
        .delete()
        .eq('id', id)

    if (error) {
        return res.status(500).json({ message: error.message })
    }

    res.json({
        message: 'Deleted'
    })
})


app.listen(PORT, () => console.log(`Server running on http://0.0.0.0:${PORT}`));
