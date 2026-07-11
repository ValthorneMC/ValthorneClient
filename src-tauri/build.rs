fn main() {
    // Cargar variables de entorno desde archivos .env
    // Intenta cargar .env.local primero (tiene prioridad), luego .env
    let _ = dotenv::from_filename(".env.local").ok();
    let _ = dotenv::dotenv().ok();
    
    // Embed environment variables at compile time
    println!("cargo:rerun-if-env-changed=SUPABASE_URL");
    println!("cargo:rerun-if-env-changed=SUPABASE_ANON_KEY");
    println!("cargo:rerun-if-changed=.env");
    println!("cargo:rerun-if-changed=.env.local");
    
    // Set compile-time environment variables
    if let Ok(url) = std::env::var("SUPABASE_URL") {
        println!("cargo:rustc-env=SUPABASE_URL={}", url);
    } else {
        println!("cargo:rustc-env=SUPABASE_URL=https://your-project.supabase.co");
    }
    
    if let Ok(key) = std::env::var("SUPABASE_ANON_KEY") {
        println!("cargo:rustc-env=SUPABASE_ANON_KEY={}", key);
    } else {
        println!("cargo:rustc-env=SUPABASE_ANON_KEY=your-anon-key");
    }
    
    tauri_build::build()
}
