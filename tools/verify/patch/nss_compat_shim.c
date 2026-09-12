/*
 * nss_compat_shim.c — supplies the one NSS symbol Chrome 153 needs that the
 * sandbox's NSS build (<= 3.22) lacks: PK11_HasAttributeSet (added in NSS 3.30).
 *
 * Implemented exactly as upstream NSS does (pk11cert.c), on top of
 * PK11_ReadRawAttribute (present since NSS 3.9.2) which resolves at load time
 * from the real libnss3.so already in the process' global symbol scope — the
 * shim is a shared object, so undefined symbols are allowed and bound from the
 * executable's own dependencies.
 *
 * Loaded via LD_PRELOAD; nss_compat_shim.map tags the exported symbol with
 * version NSS_3.22 to match the relaxed Elf64_Vernaux entry written by
 * patch_nss_version.py.
 */
typedef unsigned long CK_RV;
typedef unsigned long CK_ATTRIBUTE_TYPE;
typedef struct PK11SlotInfoStr PK11SlotInfo;
typedef struct CERTCertificateStr CERTCertificate;
typedef struct SECItemStr {
    int type;
    unsigned char *data;
    unsigned int len;
} SECItem;

#define PK11_TypeCert 3
#define CKR_OK 0UL
#define CKR_TRUE 1UL /* NSS's PK11_HasAttribute returns CKR_TRUE when present */

extern CK_RV PK11_ReadRawAttribute(int type, void *ptr, CK_ATTRIBUTE_TYPE attrib, SECItem *value);
extern void SECITEM_FreeItem(SECItem *item, int freeit);

CK_RV PK11_HasAttributeSet(PK11SlotInfo *slot, CERTCertificate *cert,
                           CK_ATTRIBUTE_TYPE *set, int count)
{
    (void)slot;
    for (int i = 0; i < count; i++) {
        SECItem item = {0, 0, 0};
        CK_RV rv = PK11_ReadRawAttribute(PK11_TypeCert, cert, set[i], &item);
        if (rv != CKR_OK)
            return rv;
        SECITEM_FreeItem(&item, 0);
    }
    return CKR_TRUE;
}
