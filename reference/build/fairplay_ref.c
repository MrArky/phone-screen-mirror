/* Reference driver: reads 164-byte keyMessage + 72-byte ekey from a binary
 * file (argv[1]), runs the KNOWN-GOOD RPiPlay playfair_decrypt (instrumented
 * to print intermediate values on stderr), prints the 16-byte key on stdout. */
#include <stdint.h>
#include <stdio.h>

void playfair_decrypt(unsigned char* message3, unsigned char* cipherText, unsigned char* keyOut);

int main(int argc, char** argv) {
	if (argc < 2) { fprintf(stderr, "usage: %s input.bin\n", argv[0]); return 2; }
	FILE* f = fopen(argv[1], "rb");
	if (!f) { fprintf(stderr, "cannot open %s\n", argv[1]); return 1; }
	unsigned char msg[164], ekey[72], keyOut[16];
	if (fread(msg, 1, 164, f) != 164) { fprintf(stderr, "short keyMessage\n"); return 1; }
	if (fread(ekey, 1, 72, f) != 72) { fprintf(stderr, "short ekey\n"); return 1; }
	fclose(f);
	playfair_decrypt(msg, ekey, keyOut);
	for (int i = 0; i < 16; i++) printf("%02x", keyOut[i]);
	printf("\n");
	return 0;
}
