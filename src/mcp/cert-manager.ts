import * as nodeCrypto from "node:crypto";
import * as forge from "node-forge";
import type ClaudeConnectorPlugin from "../main";

export interface TlsCertBundle {
	/** PEM-encoded self-signed certificate. */
	cert: string;
	/** PEM-encoded private key (PKCS#1). */
	key: string;
}

/**
 * Manages the self-signed TLS certificate used by the built-in HTTPS server.
 *
 * On first use a new RSA-2048 certificate is generated (valid for localhost /
 * 127.0.0.1 for 10 years) and persisted in the plugin's data store so Obsidian
 * restarts don't require re-trusting.
 */
export class CertManager {
	constructor(private readonly plugin: ClaudeConnectorPlugin) {}

	/**
	 * Returns the stored cert bundle, generating and persisting a new one if
	 * none exists yet.
	 */
	async ensureBundle(): Promise<TlsCertBundle> {
		if (this.plugin.settings.tlsCert && this.plugin.settings.tlsKey) {
			return {
				cert: this.plugin.settings.tlsCert,
				key: this.plugin.settings.tlsKey,
			};
		}
		return this.generateAndSave();
	}

	/**
	 * Generates a new certificate and overwrites the one stored in settings.
	 * Call this when the user explicitly requests cert rotation.
	 */
	async generateAndSave(): Promise<TlsCertBundle> {
		const bundle = CertManager.generate();
		this.plugin.settings.tlsCert = bundle.cert;
		this.plugin.settings.tlsKey = bundle.key;
		await this.plugin.saveSettings();
		return bundle;
	}

	/**
	 * Generates a self-signed TLS certificate valid for localhost / 127.0.0.1.
	 *
	 * Uses Node's native `crypto.generateKeyPairSync` for fast (native-speed)
	 * RSA key generation, then hands the keys to node-forge to construct a
	 * proper X.509 certificate with Subject Alternative Names.
	 */
	static generate(): TlsCertBundle {
		// ── Key generation (native, fast) ──────────────────────────────────
		const { privateKey: privPem, publicKey: pubPem } =
			nodeCrypto.generateKeyPairSync("rsa", {
				modulusLength: 2048,
				publicKeyEncoding: { type: "pkcs1", format: "pem" },
				privateKeyEncoding: { type: "pkcs1", format: "pem" },
			});

		// ── Import into forge for X.509 construction ───────────────────────
		const forgePub = forge.pki.publicKeyFromPem(pubPem);
		const forgePk = forge.pki.privateKeyFromPem(privPem);

		const cert = forge.pki.createCertificate();
		cert.publicKey = forgePub;
		cert.serialNumber = Date.now().toString(16);

		const notBefore = new Date();
		const notAfter = new Date(
			notBefore.getTime() + 10 * 365.25 * 24 * 60 * 60 * 1000
		);
		cert.validity.notBefore = notBefore;
		cert.validity.notAfter = notAfter;

		const attrs = [
			{ name: "commonName", value: "Obsidian Claude Connector" },
			{ name: "organizationName", value: "Obsidian Claude Connector" },
		];
		cert.setSubject(attrs);
		cert.setIssuer(attrs);

		cert.setExtensions([
			{ name: "basicConstraints", cA: false },
			{
				name: "subjectAltName",
				altNames: [
					{ type: 7, ip: "127.0.0.1" },
					{ type: 2, value: "localhost" },
				],
			},
			{ name: "keyUsage", digitalSignature: true, keyEncipherment: true },
			{ name: "extKeyUsage", serverAuth: true },
		]);

		cert.sign(forgePk, forge.md.sha256.create());

		return {
			cert: forge.pki.certificateToPem(cert),
			key: privPem,
		};
	}
}
