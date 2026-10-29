//! Thin WASM boundary over upstream libsignal.
//! Private keys stay inside the serialized store. Callers upload only `PublicBundle`.

use std::time::{SystemTime, UNIX_EPOCH};

use aes_gcm::aead::Aead;
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as B64;
use futures_util::FutureExt;
use libsignal_protocol::{
    CiphertextMessage, DeviceId, Fingerprint, GenericSignedPreKey, IdentityKey,
    IdentityKeyPair, IdentityKeyStore, InMemSignalProtocolStore, KeyPair, KyberPreKeyId,
    KyberPreKeyRecord, KyberPreKeyStore, PreKeyBundle, PreKeyId, PreKeyRecord, PreKeySignalMessage,
    PreKeyStore, ProtocolAddress, PublicKey, SenderKeyDistributionMessage,
    SenderKeyRecord, SenderKeyStore, SessionRecord, SessionStore, SignalMessage,
    SignedPreKeyId, SignedPreKeyRecord, SignedPreKeyStore, create_sender_key_distribution_message,
    group_decrypt, group_encrypt, kem, message_decrypt, message_encrypt,
    process_prekey_bundle, process_sender_key_distribution_message,
};
use rand::{Rng, TryRngCore};
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use wasm_bindgen::prelude::*;

const DEVICE_ID: u8 = 1;
const NOTE_INFO: &[u8] = b"endtoend-friend-note-v1";

fn js_err(error: impl std::fmt::Display) -> JsError {
    JsError::new(&error.to_string())
}

fn ready<T>(future: impl std::future::Future<Output = T>) -> T {
    future
        .now_or_never()
        .expect("in-memory libsignal store does not yield")
}

fn rng() -> impl rand::Rng + rand::CryptoRng {
    OsRng.unwrap_err()
}

fn now_ms() -> u64 {
    js_sys::Date::now() as u64
}

/// `SystemTime::now` panics on `wasm32-unknown-unknown`. Build the same instant from the JS clock.
fn wall_clock() -> SystemTime {
    UNIX_EPOCH + std::time::Duration::from_millis(now_ms())
}

fn address(account_id: &str) -> Result<ProtocolAddress, JsError> {
    let device = DeviceId::new(DEVICE_ID).map_err(js_err)?;
    Ok(ProtocolAddress::new(account_id.to_string(), device))
}

fn b64_encode(bytes: impl AsRef<[u8]>) -> String {
    B64.encode(bytes)
}

fn b64_decode(value: &str) -> Result<Vec<u8>, JsError> {
    B64.decode(value).map_err(js_err)
}

fn as_u32(id: impl Into<u32>) -> u32 {
    id.into()
}

#[derive(Clone, Serialize, Deserialize)]
struct NamedBlob {
    name: String,
    bytes: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct SenderKeySnap {
    sender: String,
    distribution_id: String,
    record: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Snapshot {
    registration_id: u32,
    identity_key_pair: String,
    access_key: String,
    trusted: Vec<NamedBlob>,
    sessions: Vec<NamedBlob>,
    prekeys: Vec<String>,
    signed_prekeys: Vec<String>,
    kyber_prekeys: Vec<String>,
    sender_keys: Vec<SenderKeySnap>,
}

#[derive(Clone, Serialize, Deserialize)]
struct OneTimePublic {
    id: u32,
    #[serde(rename = "publicKey")]
    public_key: String,
}

#[derive(Serialize, Deserialize)]
struct SignedPublic {
    id: u32,
    #[serde(rename = "publicKey")]
    public_key: String,
    signature: String,
}

#[derive(Serialize, Deserialize)]
struct PublicBundle {
    #[serde(rename = "registrationId")]
    registration_id: u32,
    #[serde(rename = "identityKey")]
    identity_key: String,
    #[serde(rename = "signedPreKey")]
    signed_pre_key: SignedPublic,
    #[serde(rename = "kyberPreKey")]
    kyber_pre_key: SignedPublic,
    #[serde(rename = "oneTimePreKey")]
    one_time_pre_key: Option<OneTimePublic>,
    #[serde(rename = "oneTimePreKeys")]
    one_time_pre_keys: Option<Vec<OneTimePublic>>,
    #[serde(rename = "accessKey")]
    access_key: String,
}

#[derive(Serialize)]
struct Generated {
    store: Snapshot,
    bundle: PublicBundle,
}

#[derive(Serialize)]
struct CipherResult {
    store: Snapshot,
    ciphertext: String,
}

#[derive(Serialize)]
struct PlainResult {
    store: Snapshot,
    plaintext: String,
}

#[derive(Serialize)]
struct DistributionResult {
    store: Snapshot,
    #[serde(rename = "distributionId")]
    distribution_id: String,
    distribution: String,
}

fn parse_store(json: &str) -> Result<(InMemSignalProtocolStore, Snapshot), JsError> {
    let snapshot: Snapshot = serde_json::from_str(json).map_err(js_err)?;
    let pair_bytes = b64_decode(&snapshot.identity_key_pair)?;
    let pair = IdentityKeyPair::try_from(pair_bytes.as_slice()).map_err(js_err)?;
    let mut store = InMemSignalProtocolStore::new(pair, snapshot.registration_id).map_err(js_err)?;

    for encoded in &snapshot.prekeys {
        let record = PreKeyRecord::deserialize(&b64_decode(encoded)?).map_err(js_err)?;
        let id = record.id().map_err(js_err)?;
        ready(PreKeyStore::save_pre_key(&mut store.pre_key_store, id, &record)).map_err(js_err)?;
    }
    for encoded in &snapshot.signed_prekeys {
        let record = SignedPreKeyRecord::deserialize(&b64_decode(encoded)?).map_err(js_err)?;
        let id = GenericSignedPreKey::id(&record).map_err(js_err)?;
        ready(SignedPreKeyStore::save_signed_pre_key(
            &mut store.signed_pre_key_store,
            id,
            &record,
        ))
        .map_err(js_err)?;
    }
    for encoded in &snapshot.kyber_prekeys {
        let record = KyberPreKeyRecord::deserialize(&b64_decode(encoded)?).map_err(js_err)?;
        let id = GenericSignedPreKey::id(&record).map_err(js_err)?;
        ready(KyberPreKeyStore::save_kyber_pre_key(
            &mut store.kyber_pre_key_store,
            id,
            &record,
        ))
        .map_err(js_err)?;
    }
    for trusted in &snapshot.trusted {
        let key = IdentityKey::decode(&b64_decode(&trusted.bytes)?).map_err(js_err)?;
        let remote = address(&trusted.name)?;
        ready(IdentityKeyStore::save_identity(
            &mut store.identity_store,
            &remote,
            &key,
        ))
        .map_err(js_err)?;
    }
    for session in &snapshot.sessions {
        let record = SessionRecord::deserialize(&b64_decode(&session.bytes)?).map_err(js_err)?;
        let remote = address(&session.name)?;
        ready(SessionStore::store_session(
            &mut store.session_store,
            &remote,
            &record,
        ))
        .map_err(js_err)?;
    }
    for sender_key in &snapshot.sender_keys {
        let record = SenderKeyRecord::deserialize(&b64_decode(&sender_key.record)?).map_err(js_err)?;
        let sender = address(&sender_key.sender)?;
        let distribution = Uuid::parse_str(&sender_key.distribution_id).map_err(js_err)?;
        ready(SenderKeyStore::store_sender_key(
            &mut store.sender_key_store,
            &sender,
            distribution,
            &record,
        ))
        .map_err(js_err)?;
    }
    Ok((store, snapshot))
}

fn refresh(store: &mut InMemSignalProtocolStore, mut snapshot: Snapshot, peer: Option<&str>) -> Result<Snapshot, JsError> {
    let mut peers: Vec<String> = Vec::new();
    for name in snapshot
        .sessions
        .iter()
        .map(|entry| entry.name.clone())
        .chain(snapshot.trusted.iter().map(|entry| entry.name.clone()))
    {
        if !peers.iter().any(|existing| existing == &name) {
            peers.push(name);
        }
    }
    if let Some(peer) = peer {
        if !peers.iter().any(|name| name == peer) {
            peers.push(peer.to_string());
        }
    }

    snapshot.sessions.clear();
    snapshot.trusted.clear();
    for name in peers {
        let remote = address(&name)?;
        if let Some(record) = ready(SessionStore::load_session(&store.session_store, &remote)).map_err(js_err)? {
            snapshot.sessions.push(NamedBlob {
                name: name.clone(),
                bytes: b64_encode(record.serialize().map_err(js_err)?),
            });
        }
        if let Some(identity) = ready(IdentityKeyStore::get_identity(&store.identity_store, &remote)).map_err(js_err)? {
            snapshot.trusted.push(NamedBlob {
                name,
                bytes: b64_encode(identity.serialize()),
            });
        }
    }

    snapshot.prekeys.clear();
    let prekey_ids: Vec<PreKeyId> = store.all_pre_key_ids().copied().collect();
    for id in prekey_ids {
        let record = ready(PreKeyStore::get_pre_key(&store.pre_key_store, id)).map_err(js_err)?;
        snapshot.prekeys.push(b64_encode(record.serialize().map_err(js_err)?));
    }

    snapshot.signed_prekeys.clear();
    let signed_ids: Vec<SignedPreKeyId> = store.all_signed_pre_key_ids().copied().collect();
    for id in signed_ids {
        let record = ready(SignedPreKeyStore::get_signed_pre_key(&store.signed_pre_key_store, id)).map_err(js_err)?;
        snapshot.signed_prekeys.push(b64_encode(GenericSignedPreKey::serialize(&record).map_err(js_err)?));
    }

    snapshot.kyber_prekeys.clear();
    let kyber_ids: Vec<KyberPreKeyId> = store.all_kyber_pre_key_ids().copied().collect();
    for id in kyber_ids {
        let record = ready(KyberPreKeyStore::get_kyber_pre_key(&store.kyber_pre_key_store, id)).map_err(js_err)?;
        snapshot.kyber_prekeys.push(b64_encode(GenericSignedPreKey::serialize(&record).map_err(js_err)?));
    }

    let existing = snapshot.sender_keys.clone();
    snapshot.sender_keys.clear();
    for snap in existing {
        let sender = address(&snap.sender)?;
        let distribution = Uuid::parse_str(&snap.distribution_id).map_err(js_err)?;
        if let Some(record) = ready(SenderKeyStore::load_sender_key(
            &mut store.sender_key_store,
            &sender,
            distribution,
        ))
        .map_err(js_err)?
        {
            snapshot.sender_keys.push(SenderKeySnap {
                sender: snap.sender,
                distribution_id: snap.distribution_id,
                record: b64_encode(record.serialize().map_err(js_err)?),
            });
        }
    }
    Ok(snapshot)
}

fn encode_store(snapshot: &Snapshot) -> Result<String, JsError> {
    serde_json::to_string(snapshot).map_err(js_err)
}

fn public_bundle_from_store(store: &InMemSignalProtocolStore, access_key: &str, include_all_onetime: bool) -> Result<PublicBundle, JsError> {
    let identity = ready(IdentityKeyStore::get_identity_key_pair(&store.identity_store)).map_err(js_err)?;
    let registration_id = ready(IdentityKeyStore::get_local_registration_id(&store.identity_store)).map_err(js_err)?;
    let signed_id = store.all_signed_pre_key_ids().copied().next().ok_or_else(|| js_err("missing signed prekey"))?;
    let signed = ready(SignedPreKeyStore::get_signed_pre_key(&store.signed_pre_key_store, signed_id)).map_err(js_err)?;
    let kyber_id = store.all_kyber_pre_key_ids().copied().next().ok_or_else(|| js_err("missing kyber prekey"))?;
    let kyber = ready(KyberPreKeyStore::get_kyber_pre_key(&store.kyber_pre_key_store, kyber_id)).map_err(js_err)?;
    let onetime_ids: Vec<PreKeyId> = store.all_pre_key_ids().copied().collect();
    let mut one_time_pre_keys = Vec::new();
    for id in onetime_ids {
        let record = ready(PreKeyStore::get_pre_key(&store.pre_key_store, id)).map_err(js_err)?;
        one_time_pre_keys.push(OneTimePublic {
            id: as_u32(id),
            public_key: b64_encode(record.public_key().map_err(js_err)?.serialize()),
        });
    }
    Ok(PublicBundle {
        registration_id,
        identity_key: b64_encode(identity.identity_key().serialize()),
        signed_pre_key: SignedPublic {
            id: as_u32(signed_id),
            public_key: b64_encode(GenericSignedPreKey::public_key(&signed).map_err(js_err)?.serialize()),
            signature: b64_encode(GenericSignedPreKey::signature(&signed).map_err(js_err)?),
        },
        kyber_pre_key: SignedPublic {
            id: as_u32(kyber_id),
            public_key: b64_encode(GenericSignedPreKey::public_key(&kyber).map_err(js_err)?.serialize()),
            signature: b64_encode(GenericSignedPreKey::signature(&kyber).map_err(js_err)?),
        },
        one_time_pre_key: one_time_pre_keys.first().map(|key| OneTimePublic {
            id: key.id,
            public_key: key.public_key.clone(),
        }),
        one_time_pre_keys: if include_all_onetime {
            Some(one_time_pre_keys)
        } else {
            None
        },
        access_key: access_key.to_string(),
    })
}

fn bundle_to_libsignal(bundle: &PublicBundle) -> Result<PreKeyBundle, JsError> {
    let identity = IdentityKey::decode(&b64_decode(&bundle.identity_key)?).map_err(js_err)?;
    let signed_public = PublicKey::deserialize(&b64_decode(&bundle.signed_pre_key.public_key)?).map_err(js_err)?;
    let kyber_public = kem::PublicKey::deserialize(&b64_decode(&bundle.kyber_pre_key.public_key)?).map_err(js_err)?;
    let one_time = match &bundle.one_time_pre_key {
        Some(prekey) => Some((
            PreKeyId::from(prekey.id),
            PublicKey::deserialize(&b64_decode(&prekey.public_key)?).map_err(js_err)?,
        )),
        None => None,
    };
    let device = DeviceId::new(DEVICE_ID).map_err(js_err)?;
    PreKeyBundle::new(
        bundle.registration_id,
        device,
        one_time,
        SignedPreKeyId::from(bundle.signed_pre_key.id),
        signed_public,
        b64_decode(&bundle.signed_pre_key.signature)?,
        KyberPreKeyId::from(bundle.kyber_pre_key.id),
        kyber_public,
        b64_decode(&bundle.kyber_pre_key.signature)?,
        identity,
    )
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn generate_account(account_id: &str) -> Result<String, JsError> {
    let _ = address(account_id)?;
    let mut random = rng();
    let identity = IdentityKeyPair::generate(&mut random);
    let registration_id = (random.random::<u32>() % 16380) + 1;
    let mut store = InMemSignalProtocolStore::new(identity, registration_id).map_err(js_err)?;

    let signed_pair = KeyPair::generate(&mut random);
    let signed_signature = identity
        .private_key()
        .calculate_signature(&signed_pair.public_key.serialize(), &mut random)
        .map_err(js_err)?;
    let signed_id = SignedPreKeyId::from(1u32);
    let signed = SignedPreKeyRecord::new(
        signed_id,
        libsignal_protocol::Timestamp::from_epoch_millis(now_ms()),
        &signed_pair,
        signed_signature.as_ref(),
    );
    ready(SignedPreKeyStore::save_signed_pre_key(
        &mut store.signed_pre_key_store,
        signed_id,
        &signed,
    ))
    .map_err(js_err)?;

    let kyber_id = KyberPreKeyId::from(1u32);
    let kyber_pair = kem::KeyPair::generate(kem::KeyType::Kyber1024, &mut random);
    let kyber_signature = identity
        .private_key()
        .calculate_signature(&kyber_pair.public_key.serialize(), &mut random)
        .map_err(js_err)?;
    let kyber = KyberPreKeyRecord::new(
        kyber_id,
        libsignal_protocol::Timestamp::from_epoch_millis(now_ms()),
        &kyber_pair,
        kyber_signature.as_ref(),
    );
    ready(KyberPreKeyStore::save_kyber_pre_key(
        &mut store.kyber_pre_key_store,
        kyber_id,
        &kyber,
    ))
    .map_err(js_err)?;

    for index in 1u32..=20 {
        let id = PreKeyId::from(index);
        let pair = KeyPair::generate(&mut random);
        let record = PreKeyRecord::new(id, &pair);
        ready(PreKeyStore::save_pre_key(&mut store.pre_key_store, id, &record)).map_err(js_err)?;
    }

    let access_key: [u8; 32] = random.random();
    let snapshot = Snapshot {
        registration_id,
        identity_key_pair: b64_encode(identity.serialize()),
        access_key: b64_encode(access_key),
        trusted: Vec::new(),
        sessions: Vec::new(),
        prekeys: Vec::new(),
        signed_prekeys: Vec::new(),
        kyber_prekeys: Vec::new(),
        sender_keys: Vec::new(),
    };
    let snapshot = refresh(&mut store, snapshot, None)?;
    let bundle = public_bundle_from_store(&store, &snapshot.access_key, true)?;
    serde_json::to_string(&Generated { store: snapshot, bundle }).map_err(js_err)
}

#[wasm_bindgen]
pub fn establish_session(store_json: &str, local_account_id: &str, remote_account_id: &str, bundle_json: &str) -> Result<String, JsError> {
    let (mut store, snapshot) = parse_store(store_json)?;
    let bundle: PublicBundle = serde_json::from_str(bundle_json).map_err(js_err)?;
    let remote_bundle = bundle_to_libsignal(&bundle)?;
    let local = address(local_account_id)?;
    let remote = address(remote_account_id)?;
    let mut random = rng();
    ready(process_prekey_bundle(
        &remote,
        &local,
        &mut store.session_store,
        &mut store.identity_store,
        &remote_bundle,
        wall_clock(),
        &mut random,
    ))
    .map_err(js_err)?;
    let snapshot = refresh(&mut store, snapshot, Some(remote_account_id))?;
    encode_store(&snapshot)
}

#[wasm_bindgen]
pub fn encrypt_message(store_json: &str, local_account_id: &str, remote_account_id: &str, plaintext: &str) -> Result<String, JsError> {
    let (mut store, snapshot) = parse_store(store_json)?;
    let local = address(local_account_id)?;
    let remote = address(remote_account_id)?;
    let mut random = rng();
    let message = ready(message_encrypt(
        plaintext.as_bytes(),
        &remote,
        &local,
        &mut store.session_store,
        &mut store.identity_store,
        wall_clock(),
        &mut random,
    ))
    .map_err(js_err)?;
    let snapshot = refresh(&mut store, snapshot, Some(remote_account_id))?;
    serde_json::to_string(&CipherResult {
        store: snapshot,
        ciphertext: b64_encode(message.serialize()),
    })
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn decrypt_message(store_json: &str, local_account_id: &str, remote_account_id: &str, ciphertext_b64: &str) -> Result<String, JsError> {
    let (mut store, snapshot) = parse_store(store_json)?;
    let bytes = b64_decode(ciphertext_b64)?;
    let message = if let Ok(prekey) = PreKeySignalMessage::try_from(bytes.as_slice()) {
        CiphertextMessage::PreKeySignalMessage(prekey)
    } else {
        CiphertextMessage::SignalMessage(SignalMessage::try_from(bytes.as_slice()).map_err(js_err)?)
    };
    let local = address(local_account_id)?;
    let remote = address(remote_account_id)?;
    let mut random = rng();
    let plaintext = ready(message_decrypt(
        &message,
        &remote,
        &local,
        &mut store.session_store,
        &mut store.identity_store,
        &mut store.pre_key_store,
        &store.signed_pre_key_store,
        &mut store.kyber_pre_key_store,
        &mut random,
    ))
    .map_err(js_err)?;
    let snapshot = refresh(&mut store, snapshot, Some(remote_account_id))?;
    let text = String::from_utf8(plaintext).map_err(js_err)?;
    serde_json::to_string(&PlainResult {
        store: snapshot,
        plaintext: text,
    })
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn safety_number(store_json: &str, local_account_id: &str, remote_account_id: &str, remote_identity_b64: &str) -> Result<String, JsError> {
    let (store, _) = parse_store(store_json)?;
    let local_identity = ready(IdentityKeyStore::get_identity_key_pair(&store.identity_store)).map_err(js_err)?;
    let remote_identity = IdentityKey::decode(&b64_decode(remote_identity_b64)?).map_err(js_err)?;
    let fingerprint = Fingerprint::new(
        2,
        5200,
        local_account_id.as_bytes(),
        local_identity.identity_key(),
        remote_account_id.as_bytes(),
        &remote_identity,
    )
    .map_err(js_err)?;
    fingerprint.display_string().map_err(js_err)
}

#[wasm_bindgen]
pub fn trust_identity(store_json: &str, remote_account_id: &str, identity_b64: &str) -> Result<String, JsError> {
    let (mut store, snapshot) = parse_store(store_json)?;
    let identity = IdentityKey::decode(&b64_decode(identity_b64)?).map_err(js_err)?;
    let remote = address(remote_account_id)?;
    ready(IdentityKeyStore::save_identity(
        &mut store.identity_store,
        &remote,
        &identity,
    ))
    .map_err(js_err)?;
    let snapshot = refresh(&mut store, snapshot, Some(remote_account_id))?;
    encode_store(&snapshot)
}

#[wasm_bindgen]
pub fn wipe_session(store_json: &str, remote_account_id: &str) -> Result<String, JsError> {
    let snapshot: Snapshot = serde_json::from_str(store_json).map_err(js_err)?;
    let mut next = snapshot;
    next.sessions.retain(|session| session.name != remote_account_id);
    encode_store(&next)
}

#[wasm_bindgen]
pub fn rotate_access_key(store_json: &str) -> Result<String, JsError> {
    let mut snapshot: Snapshot = serde_json::from_str(store_json).map_err(js_err)?;
    let mut random = rng();
    let access_key: [u8; 32] = random.random();
    snapshot.access_key = b64_encode(access_key);
    encode_store(&snapshot)
}

#[wasm_bindgen]
pub fn prekey_identity(ciphertext_b64: &str) -> Result<String, JsError> {
    let bytes = b64_decode(ciphertext_b64)?;
    let message = PreKeySignalMessage::try_from(bytes.as_slice()).map_err(js_err)?;
    Ok(b64_encode(message.identity_key().serialize()))
}

#[wasm_bindgen]
pub fn create_sender_key(store_json: &str, local_account_id: &str, distribution_id: &str) -> Result<String, JsError> {
    let (mut store, mut snapshot) = parse_store(store_json)?;
    let local = address(local_account_id)?;
    let distribution = Uuid::parse_str(distribution_id).map_err(js_err)?;
    let mut random = rng();
    let message = ready(create_sender_key_distribution_message(
        &local,
        distribution,
        &mut store.sender_key_store,
        &mut random,
    ))
    .map_err(js_err)?;
    if let Some(record) = ready(SenderKeyStore::load_sender_key(
        &mut store.sender_key_store,
        &local,
        distribution,
    ))
    .map_err(js_err)?
    {
        snapshot.sender_keys.retain(|entry| {
            !(entry.sender == local_account_id && entry.distribution_id == distribution_id)
        });
        snapshot.sender_keys.push(SenderKeySnap {
            sender: local_account_id.to_string(),
            distribution_id: distribution_id.to_string(),
            record: b64_encode(record.serialize().map_err(js_err)?),
        });
    }
    serde_json::to_string(&DistributionResult {
        store: snapshot,
        distribution_id: distribution_id.to_string(),
        distribution: b64_encode(message.serialized()),
    })
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn process_sender_key(store_json: &str, sender_account_id: &str, distribution_b64: &str) -> Result<String, JsError> {
    let (mut store, mut snapshot) = parse_store(store_json)?;
    let sender = address(sender_account_id)?;
    let bytes = b64_decode(distribution_b64)?;
    let message = SenderKeyDistributionMessage::try_from(bytes.as_slice()).map_err(js_err)?;
    let distribution = message.distribution_id().map_err(js_err)?;
    ready(process_sender_key_distribution_message(
        &sender,
        &message,
        &mut store.sender_key_store,
    ))
    .map_err(js_err)?;
    if let Some(record) = ready(SenderKeyStore::load_sender_key(
        &mut store.sender_key_store,
        &sender,
        distribution,
    ))
    .map_err(js_err)?
    {
        let distribution_id = distribution.to_string();
        snapshot.sender_keys.retain(|entry| {
            !(entry.sender == sender_account_id && entry.distribution_id == distribution_id)
        });
        snapshot.sender_keys.push(SenderKeySnap {
            sender: sender_account_id.to_string(),
            distribution_id,
            record: b64_encode(record.serialize().map_err(js_err)?),
        });
    }
    encode_store(&snapshot)
}

#[wasm_bindgen]
pub fn group_encrypt_message(store_json: &str, local_account_id: &str, distribution_id: &str, plaintext: &str) -> Result<String, JsError> {
    let (mut store, mut snapshot) = parse_store(store_json)?;
    let local = address(local_account_id)?;
    let distribution = Uuid::parse_str(distribution_id).map_err(js_err)?;
    let mut random = rng();
    let message = ready(group_encrypt(
        &mut store.sender_key_store,
        &local,
        distribution,
        plaintext.as_bytes(),
        &mut random,
    ))
    .map_err(js_err)?;
    if let Some(record) = ready(SenderKeyStore::load_sender_key(
        &mut store.sender_key_store,
        &local,
        distribution,
    ))
    .map_err(js_err)?
    {
        snapshot.sender_keys.retain(|entry| {
            !(entry.sender == local_account_id && entry.distribution_id == distribution_id)
        });
        snapshot.sender_keys.push(SenderKeySnap {
            sender: local_account_id.to_string(),
            distribution_id: distribution_id.to_string(),
            record: b64_encode(record.serialize().map_err(js_err)?),
        });
    }
    serde_json::to_string(&CipherResult {
        store: snapshot,
        ciphertext: b64_encode(message.serialized()),
    })
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn group_decrypt_message(store_json: &str, sender_account_id: &str, ciphertext_b64: &str) -> Result<String, JsError> {
    let (mut store, mut snapshot) = parse_store(store_json)?;
    let sender = address(sender_account_id)?;
    let bytes = b64_decode(ciphertext_b64)?;
    let plaintext = ready(group_decrypt(&bytes, &mut store.sender_key_store, &sender)).map_err(js_err)?;
    let distribution = libsignal_protocol::SenderKeyMessage::try_from(bytes.as_slice())
        .map_err(js_err)?
        .distribution_id();
    if let Some(record) = ready(SenderKeyStore::load_sender_key(
        &mut store.sender_key_store,
        &sender,
        distribution,
    ))
    .map_err(js_err)?
    {
        let distribution_id = distribution.to_string();
        snapshot.sender_keys.retain(|entry| {
            !(entry.sender == sender_account_id && entry.distribution_id == distribution_id)
        });
        snapshot.sender_keys.push(SenderKeySnap {
            sender: sender_account_id.to_string(),
            distribution_id,
            record: b64_encode(record.serialize().map_err(js_err)?),
        });
    }
    let text = String::from_utf8(plaintext).map_err(js_err)?;
    serde_json::to_string(&PlainResult {
        store: snapshot,
        plaintext: text,
    })
    .map_err(js_err)
}

#[wasm_bindgen]
pub fn seal_note(recipient_identity_b64: &str, plaintext: &str) -> Result<String, JsError> {
    let recipient = IdentityKey::decode(&b64_decode(recipient_identity_b64)?).map_err(js_err)?;
    let mut random = rng();
    let ephemeral = KeyPair::generate(&mut random);
    let shared = ephemeral
        .private_key
        .calculate_agreement(recipient.public_key())
        .map_err(js_err)?;
    let mut key = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(None, &shared)
        .expand(NOTE_INFO, &mut key)
        .map_err(js_err)?;
    let nonce_bytes: [u8; 12] = random.random();
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(js_err)?;
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce_bytes), plaintext.as_bytes())
        .map_err(js_err)?;
    let mut packed = Vec::new();
    packed.extend_from_slice(&ephemeral.public_key.serialize());
    packed.extend_from_slice(&nonce_bytes);
    packed.extend_from_slice(&ciphertext);
    Ok(b64_encode(packed))
}

#[wasm_bindgen]
pub fn open_note(store_json: &str, sealed_b64: &str) -> Result<String, JsError> {
    let (store, _) = parse_store(store_json)?;
    let identity = ready(IdentityKeyStore::get_identity_key_pair(&store.identity_store)).map_err(js_err)?;
    let packed = b64_decode(sealed_b64)?;
    if packed.len() < 33 + 12 + 16 {
        return Err(js_err("sealed note is too short"));
    }
    let ephemeral = PublicKey::deserialize(&packed[..33]).map_err(js_err)?;
    let nonce_bytes = &packed[33..45];
    let ciphertext = &packed[45..];
    let shared = identity
        .private_key()
        .calculate_agreement(&ephemeral)
        .map_err(js_err)?;
    let mut key = [0u8; 32];
    hkdf::Hkdf::<sha2::Sha256>::new(None, &shared)
        .expand(NOTE_INFO, &mut key)
        .map_err(js_err)?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(js_err)?;
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(js_err)?;
    String::from_utf8(plaintext).map_err(js_err)
}

#[wasm_bindgen]
pub fn local_identity(store_json: &str) -> Result<String, JsError> {
    let (store, _) = parse_store(store_json)?;
    let identity = ready(IdentityKeyStore::get_identity_key_pair(&store.identity_store)).map_err(js_err)?;
    Ok(b64_encode(identity.identity_key().serialize()))
}
