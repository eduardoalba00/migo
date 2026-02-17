use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite;
use url::Url;

use crate::error::EngineError;

/// Messages from the signaling task to the transport.
#[derive(Debug)]
pub enum SignalEvent {
    Join(livekit_protocol::JoinResponse),
    Offer(livekit_protocol::SessionDescription),
    Answer(livekit_protocol::SessionDescription),
    Trickle(livekit_protocol::TrickleRequest),
    TrackPublished(livekit_protocol::TrackPublishedResponse),
    Leave,
}

/// Handle for sending messages to the LiveKit signal server.
#[derive(Clone)]
pub struct SignalSender {
    tx: mpsc::UnboundedSender<livekit_protocol::SignalRequest>,
}

impl SignalSender {
    pub fn send_offer(&self, sdp: String) {
        let req = livekit_protocol::SignalRequest {
            message: Some(livekit_protocol::signal_request::Message::Offer(
                livekit_protocol::SessionDescription {
                    r#type: "offer".to_string(),
                    sdp,
                    ..Default::default()
                },
            )),
        };
        let _ = self.tx.send(req);
    }

    pub fn send_answer(&self, sdp: String) {
        let req = livekit_protocol::SignalRequest {
            message: Some(livekit_protocol::signal_request::Message::Answer(
                livekit_protocol::SessionDescription {
                    r#type: "answer".to_string(),
                    sdp,
                    ..Default::default()
                },
            )),
        };
        let _ = self.tx.send(req);
    }

    pub fn send_trickle(&self, candidate_init: String, target: i32) {
        let req = livekit_protocol::SignalRequest {
            message: Some(livekit_protocol::signal_request::Message::Trickle(
                livekit_protocol::TrickleRequest {
                    candidate_init,
                    target,
                    r#final: false,
                },
            )),
        };
        let _ = self.tx.send(req);
    }

    pub fn send_add_track(
        &self,
        cid: String,
        name: String,
        track_type: i32,
        source: i32,
        width: u32,
        height: u32,
    ) {
        let req = livekit_protocol::SignalRequest {
            message: Some(livekit_protocol::signal_request::Message::AddTrack(
                livekit_protocol::AddTrackRequest {
                    cid,
                    name,
                    r#type: track_type,
                    source,
                    width,
                    height,
                    muted: false,
                    ..Default::default()
                },
            )),
        };
        let _ = self.tx.send(req);
    }

    pub fn send_leave(&self) {
        let req = livekit_protocol::SignalRequest {
            message: Some(livekit_protocol::signal_request::Message::Leave(
                livekit_protocol::LeaveRequest {
                    ..Default::default()
                },
            )),
        };
        let _ = self.tx.send(req);
    }
}

/// Build the WebSocket URL for connecting to LiveKit signal endpoint.
fn build_ws_url(server_url: &str, token: &str) -> Result<String, EngineError> {
    let mut url = Url::parse(server_url)
        .map_err(|e| EngineError::Transport(format!("Invalid URL: {e}")))?;

    // Convert http(s) to ws(s)
    match url.scheme() {
        "https" | "wss" => url.set_scheme("wss").unwrap(),
        _ => url.set_scheme("ws").unwrap(),
    };

    url.set_path("/rtc");
    url.query_pairs_mut()
        .append_pair("sdk", "rust-media-engine")
        .append_pair("protocol", "16")
        .append_pair("version", crate::VERSION)
        .append_pair("auto_subscribe", "1")
        .append_pair("adaptive_stream", "0")
        .append_pair("access_token", token);

    Ok(url.to_string())
}

/// Connect to LiveKit signal server and run the send/receive loops.
/// Returns (SignalSender, event_rx) for communicating with the signal task.
pub async fn connect(
    server_url: &str,
    token: &str,
) -> Result<(SignalSender, mpsc::UnboundedReceiver<SignalEvent>), EngineError> {
    let ws_url = build_ws_url(server_url, token)?;

    let (ws_stream, _) = tokio_tungstenite::connect_async(&ws_url)
        .await
        .map_err(|e| EngineError::Transport(format!("WebSocket connect: {e}")))?;

    let (ws_sink, ws_source) = ws_stream.split();

    // Channel for outgoing signal requests
    let (send_tx, send_rx) = mpsc::unbounded_channel::<livekit_protocol::SignalRequest>();
    // Channel for incoming signal events
    let (event_tx, event_rx) = mpsc::unbounded_channel::<SignalEvent>();

    // Spawn sender task: forwards SignalRequest → WebSocket
    let sender = SignalSender { tx: send_tx };
    tokio::spawn(signal_send_loop(ws_sink, send_rx));

    // Spawn receiver task: WebSocket → SignalEvent
    tokio::spawn(signal_recv_loop(ws_source, event_tx));

    Ok((sender, event_rx))
}

async fn signal_send_loop(
    mut sink: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        tungstenite::Message,
    >,
    mut rx: mpsc::UnboundedReceiver<livekit_protocol::SignalRequest>,
) {
    while let Some(req) = rx.recv().await {
        let bytes = req.encode_to_vec();
        if sink
            .send(tungstenite::Message::Binary(bytes.into()))
            .await
            .is_err()
        {
            break;
        }
    }
}

async fn signal_recv_loop(
    mut source: futures_util::stream::SplitStream<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    >,
    event_tx: mpsc::UnboundedSender<SignalEvent>,
) {
    while let Some(msg) = source.next().await {
        let data = match msg {
            Ok(tungstenite::Message::Binary(data)) => data,
            Ok(tungstenite::Message::Close(_)) => break,
            Ok(_) => continue,
            Err(_) => break,
        };

        let resp = match livekit_protocol::SignalResponse::decode(data.as_ref()) {
            Ok(r) => r,
            Err(_) => continue,
        };

        let event = match resp.message {
            Some(livekit_protocol::signal_response::Message::Join(j)) => {
                SignalEvent::Join(j)
            }
            Some(livekit_protocol::signal_response::Message::Offer(o)) => {
                SignalEvent::Offer(o)
            }
            Some(livekit_protocol::signal_response::Message::Answer(a)) => {
                SignalEvent::Answer(a)
            }
            Some(livekit_protocol::signal_response::Message::Trickle(t)) => {
                SignalEvent::Trickle(t)
            }
            Some(livekit_protocol::signal_response::Message::TrackPublished(p)) => {
                SignalEvent::TrackPublished(p)
            }
            Some(livekit_protocol::signal_response::Message::Leave(_)) => {
                SignalEvent::Leave
            }
            _ => continue,
        };

        if event_tx.send(event).is_err() {
            break;
        }
    }
}
