use once_cell::sync::Lazy;
use reqwest::Client;
use std::time::Duration;

/// Cliente HTTP global 
pub static HTTP_CLIENT: Lazy<Client> = Lazy::new(|| {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Ok(header) = reqwest::header::HeaderValue::from_str(&format!(
        "KindlyKlanKlient/{} (hola@kindlyklan.com)",
        env!("CARGO_PKG_VERSION")
    )) {
        headers.insert(reqwest::header::USER_AGENT, header);
    }

    Client::builder()
        .tcp_keepalive(Some(Duration::from_secs(10)))
        .timeout(Duration::from_secs(30))
        .default_headers(headers)
        .build()
        .expect("Failed to create HTTP client")
});

