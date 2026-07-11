use log::{Level, LevelFilter, Metadata, Record};
use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;
use chrono::Local;

pub struct Logger {
    file: Mutex<BufWriter<File>>,
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
        })
    }
    
    pub fn get_log_directory() -> Result<PathBuf, Box<dyn std::error::Error>> {
        let mut log_dir = dirs::data_dir()
            .ok_or("No data directory found")?;
        
        log_dir.push("KindlyKlanKlient");
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
        
        // Keep only the last 7 days of logs
        log_files.sort_by(|a, b| b.cmp(a));
        
        for (index, log_file) in log_files.iter().enumerate() {
            if index >= 7 {
                // Compress old logs
                let compressed_name = log_file.with_extension("log.gz");
                
                // Simple compression using gzip (if available)
                if let Ok(_file) = std::fs::File::open(log_file) {
                    if let Ok(_compressed) = std::fs::File::create(&compressed_name) {
                        // For now, just rename the file
                        // In a real implementation, you'd use a compression library
                        std::fs::rename(log_file, &compressed_name)?;
                    }
                }
            }
        }
        
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
            
            if let Ok(mut file) = self.file.lock() {
                let _ = file.write_all(log_line.as_bytes());
                let _ = file.flush();
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
