import { BLOCO_01 } from "./bloco-01";
import { BLOCO_02 } from "./bloco-02";
import { BLOCO_03 } from "./bloco-03";
import { BLOCO_04 } from "./bloco-04";
import { BLOCO_05 } from "./bloco-05";

/**
 * Blocos versionados do banco oficial. Cada bloco segue o formato:
 * categoria|dificuldade|enunciado|A|B|C|D|correta|justificativa|fonte|tags
 * Para expandir o banco, crie um novo bloco e adicione-o aqui (a importação é idempotente).
 */
export const BANK_BLOCKS: string[] = [BLOCO_01, BLOCO_02, BLOCO_03, BLOCO_04, BLOCO_05];
