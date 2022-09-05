import { JSONSchemaType } from "ajv";

export interface ModInfo {
    name: string;
    poster: string;
    id: string;
    description: string;
    url: string;
}

export interface PipeWrenchConfig {
    modInfo: ModInfo;
    modelsDir: string;
    texturesDir: string;
    soundDir: string;
    scriptsDir: string;
}
export const PipeWrenchConfigSchema: JSONSchemaType<PipeWrenchConfig> = {
    type: 'object',
    properties: {
        modInfo: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                poster: { type: 'string' },
                id: { type: 'string' },
                description: { type: 'string' },
                url: { type: 'string' }
            },
            required: ['name', 'poster', 'id', 'description', 'url']
        },
        modelsDir: { type: 'string' },
        texturesDir: { type: 'string' },
        soundDir: { type: 'string' },
        scriptsDir: { type: 'string' }
    },
    required: ['modInfo', 'modelsDir', 'texturesDir', 'soundDir', 'scriptsDir'],
    additionalProperties: false
};