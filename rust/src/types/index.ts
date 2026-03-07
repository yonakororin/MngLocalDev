
export interface Config {
    profile: string;
    project_root: string;
    wsl_distro: string;
    compose_file: string;
    phpenv_root: string;
    web_port?: number;
}

export interface Assignment {
    folder: string;
    wsl_path: string;
    win_path: string;
    php_version: string;
    port: number;
    url_path: string;
    doc_root: string;
}

export interface CronJob {
    id: number;
    schedule: string;
    command: string;
    description: string;
    start_time?: string;
    end_time?: string;
    exit_code?: number | null;
}

export interface CronEnvVar {
    id: number;
    name: string;
    value: string;
    description: string;
}

export interface CronWrapper {
    id: number;
    name: string;
    value: string;
    description: string;
}
