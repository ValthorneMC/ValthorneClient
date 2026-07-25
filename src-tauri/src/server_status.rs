use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerStatus {
    pub online: bool,
    pub players_online: i64,
    pub players_max: i64,
    pub version_name: Option<String>,
}

fn write_varint(buf: &mut Vec<u8>, mut value: i32) {
    loop {
        let mut byte = (value & 0x7F) as u8;
        value = ((value as u32) >> 7) as i32;
        if value != 0 {
            byte |= 0x80;
        }
        buf.push(byte);
        if value == 0 {
            break;
        }
    }
}

async fn read_varint(stream: &mut TcpStream) -> anyhow::Result<i32> {
    let mut value: i32 = 0;
    let mut position = 0;
    loop {
        let mut byte = [0u8; 1];
        stream.read_exact(&mut byte).await?;
        let byte = byte[0];
        value |= ((byte & 0x7F) as i32) << position;
        if byte & 0x80 == 0 {
            break;
        }
        position += 7;
        if position >= 32 {
            anyhow::bail!("VarInt demasiado grande");
        }
    }
    Ok(value)
}

fn write_string(buf: &mut Vec<u8>, s: &str) {
    write_varint(buf, s.len() as i32);
    buf.extend_from_slice(s.as_bytes());
}

/// Queries the status of a Minecraft Java Edition server via Server List Ping (SLP).
async fn ping_server(host: &str, port: u16) -> anyhow::Result<ServerStatus> {
    let mut stream = TcpStream::connect((host, port)).await?;

    let mut handshake_data = Vec::new();
    write_varint(&mut handshake_data, 0x00);
    write_varint(&mut handshake_data, 767); // protocol version, irrelevant for status
    write_string(&mut handshake_data, host);
    handshake_data.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake_data, 1); // next state: status

    let mut handshake_packet = Vec::new();
    write_varint(&mut handshake_packet, handshake_data.len() as i32);
    handshake_packet.extend_from_slice(&handshake_data);
    stream.write_all(&handshake_packet).await?;

    let mut request_packet = Vec::new();
    write_varint(&mut request_packet, 1); // length: 1 byte for packet id
    write_varint(&mut request_packet, 0x00);
    stream.write_all(&request_packet).await?;

    let _length = read_varint(&mut stream).await?;
    let _packet_id = read_varint(&mut stream).await?;
    let str_len = read_varint(&mut stream).await? as usize;
    let mut json_buf = vec![0u8; str_len];
    stream.read_exact(&mut json_buf).await?;
    let json_str = String::from_utf8_lossy(&json_buf).to_string();

    let parsed: serde_json::Value = serde_json::from_str(&json_str)?;
    let players_online = parsed["players"]["online"].as_i64().unwrap_or(0);
    let players_max = parsed["players"]["max"].as_i64().unwrap_or(0);
    let version_name = parsed["version"]["name"].as_str().map(|s| s.to_string());

    Ok(ServerStatus {
        online: true,
        players_online,
        players_max,
        version_name,
    })
}

/// Returns the status of the Valthorne server (players online), used on the home screen.
/// If the server doesn't respond within 5s, it's reported as offline instead of propagating the error.
#[tauri::command]
pub async fn get_valthorne_server_status() -> Result<ServerStatus, String> {
    match timeout(Duration::from_secs(5), ping_server("playvalthorne.com", 25565)).await {
        Ok(Ok(status)) => Ok(status),
        _ => Ok(ServerStatus {
            online: false,
            players_online: 0,
            players_max: 0,
            version_name: None,
        }),
    }
}
