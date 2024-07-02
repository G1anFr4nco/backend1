const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();
const { Pool } = require('pg');

// Configurar la conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors());

// Función para crear la tabla si no existe
const createTableIfNotExists = async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id SERIAL PRIMARY KEY,
        video_id VARCHAR(255) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        views INTEGER DEFAULT 0
      )
    `);
  } catch (error) {
    console.error('Error creating table:', error);
  } finally {
    client.release();
  }
};

createTableIfNotExists();

const fetchVideos = async (categoryId) => {
  const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      part: 'snippet',
      chart: 'mostPopular',
      regionCode: 'US',
      maxResults: 10,
      videoCategoryId: categoryId,
      key: process.env.YOUTUBE_API_KEY
    }
  });

  return response.data.items.map(video => ({
    videoId: video.id,
    title: video.snippet.title,
    thumbnail: video.snippet.thumbnails.default.url,
  }));
};

app.get('/api/videos', async (req, res) => {
  try {
    const [movies, animation, technology] = await Promise.all([
      fetchVideos('1'),
      fetchVideos('10'),
      fetchVideos('28')
    ]);

    const videos = [...movies, ...animation, ...technology];
    res.send(videos);
  } catch (error) {
    console.error('Error fetching videos:', error);
    res.status(500).send('Server error');
  }
});

app.post('/api/view', async (req, res) => {
  const { videoId, title } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let result = await client.query('SELECT * FROM videos WHERE video_id = $1', [videoId]);
    if (result.rows.length === 0) {
      await client.query('INSERT INTO videos (video_id, title, views) VALUES ($1, $2, $3)', [videoId, title, 1]);
    } else {
      await client.query('UPDATE videos SET views = views + 1 WHERE video_id = $1', [videoId]);
    }
    await client.query('COMMIT');

    result = await client.query('SELECT * FROM videos WHERE video_id = $1', [videoId]);
    const video = result.rows[0];

    io.emit('videoViewed', { videoId: video.video_id, title: video.title, views: video.views });

    res.sendStatus(200);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing view:', error);
    res.status(500).send('Server error');
  } finally {
    client.release();
  }
});

app.get('/api/videoViews', async (req, res) => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM videos ORDER BY views DESC LIMIT 20');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching video views:', error);
    res.status(500).send('Server error');
  } finally {
    client.release();
  }
});

io.on('connection', (socket) => {
  console.log('New client connected');
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

const port = process.env.PORT || 4000;
server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
