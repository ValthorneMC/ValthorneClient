use log::{Level, LevelFilter, Metadata, Record};
use std::fs::{File, OpenOptions};
use std::io::{BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use chrono::Local;
use flate2::{write::GzEncoder, Compression};

/// How many buffered Info/Debug lines to let pile up before forcing a flush. Warn/Error
/// always flush immediately regardless of this.
const FLUSH_EVERY_N_LINES: u32 = 50;

pub struct Logger {
    file: Mutex<BufWriter<File>>,
    lines_since_flush: AtomicU32,
}

impl Logger {
    pub fn new() -> Result<Self, Box<dyn std::error::Error>> {
        let log_dir = Self::get_log_directory()?;
        std::fs::create_dir_all(&log_dir)?;
        
        // Create log file with timestamp
        let timestamp = Local::now().format("%Y-%m-%d");
        let log_file = log_dir.join(format!("launcher-{}.log", timestamp));
        
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_file)?;
        
        Ok(Logger {
            file: Mutex::new(BufWriter::new(file)),
            lines_since_flush: AtomicU32::new(0),
        })
    }
    
    pub fn get_log_directory() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let mut log_dir = dirs::data_dir()
            .ok_or("No data directory found")?;
        
        log_dir.push("ValthorneClient");
        log_dir.push("logs");
        
        Ok(log_dir)
    }
    
    pub fn compress_old_logs(&self) -> Result<(), Box<dyn std::error::Error>> {
        let log_dir = Self::get_log_directory()?;
        
        if !log_dir.exists() {
            return Ok(());
        }
        
        let entries = std::fs::read_dir(&log_dir)?;
        let mut log_files: Vec<PathBuf> = Vec::new();
        
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            
            if path.is_file() && path.extension().and_then(|s| s.to_str()) == Some("log") {
                log_files.push(path);
            }
        }
        
        // Keep only the last 7 days of logs uncompressed
        log_files.sort_by(|a, b| b.cmp(a));

        for log_file in log_files.iter().skip(7) {
            if let Err(e) = Self::gzip_file(log_file) {
                log::warn!("Failed to compress log {:?}: {}", log_file, e);
            }
        }

        Ok(())
    }

    /// Gzip-compresses a log file in place and removes the original.
    fn gzip_file(path: &PathBuf) -> Result<(), Box<dyn std::error::Error>> {
        let compressed_path = path.with_extension("log.gz");

        {
            let mut input = BufReader::new(File::open(path)?);
            let output = File::create(&compressed_path)?;
            let mut encoder = GzEncoder::new(output, Compression::default());
            std::io::copy(&mut input, &mut encoder)?;
            encoder.finish()?;
        }

        std::fs::remove_file(path)?;
        Ok(())
    }
}

impl log::Log for Logger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Info
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
            let level = record.level();
            let target = record.target();
            let args = record.args();
            
            let log_line = format!("[{}] {} {}: {}\n", timestamp, level, target, args);
            
            // Warn/Error flush immediately (worth the I/O cost for anything worth noticing);
            // Info/Debug (this is where all of Minecraft's redirected stdout/stderr lands,
            // which can be extremely noisy) only flush every FLUSH_EVERY_N_LINES lines.
            let should_flush = level <= Level::Warn
                || self.lines_since_flush.fetch_add(1, Ordering::Relaxed) + 1 >= FLUSH_EVERY_N_LINES;

            if let Ok(mut file) = self.file.lock() {
                let _ = file.write_all(log_line.as_bytes());
                if should_flush {
                    let _ = file.flush();
                    self.lines_since_flush.store(0, Ordering::Relaxed);
                }
            }
            
            // Also print to console in debug mode
            #[cfg(debug_assertions)]
            println!("{}", log_line.trim());
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

pub fn init_logging() -> Result<(), Box<dyn std::error::Error>> {
    let logger = Logger::new()?;
    
    // Compress old logs
    logger.compress_old_logs()?;
    
    log::set_boxed_logger(Box::new(logger))?;
    log::set_max_level(LevelFilter::Info);
    
    log::info!("Logging system initialized");
    log::info!("Log directory: {:?}", Logger::get_log_directory()?);
    
    Ok(())
}
