import app from './src/app.js';
import { config } from './src/config/env.js';
import { cleanupService } from './src/services/cleanup.service.js';

const PORT = config.port;
const HOST = '0.0.0.0'; // Bind to all interfaces for Render and cloud containers

const server = app.listen(PORT, HOST, () => {
  console.log(`===============================================`);
  console.log(`🚀 QuickShare server is active!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`🔒 Environment: ${config.nodeEnv}`);
  console.log(`💾 Storage: ${config.supabase.isConfigured ? 'Supabase Storage (' + config.supabase.bucketName + ')' : 'Local File Storage'}`);
  console.log(`🗄️ Database: ${config.supabase.isConfigured ? 'Supabase PostgreSQL' : 'Local Memory DB'}`);
  console.log(`===============================================`);

  // Start background cleanup job for expired files
  cleanupService.startScheduler(config.cleanupIntervalMinutes);
});

// Graceful shutdown handling
function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Gracefully shutting down QuickShare...`);
  cleanupService.stopScheduler();
  server.close(() => {
    console.log('🏁 HTTP server closed. Process exiting.');
    process.exit(0);
  });

  // Force exit if shutdown takes too long
  setTimeout(() => {
    console.error('⚠️ Forcefully terminating after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

