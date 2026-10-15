export interface EpisodeInput {
    goal: string;
    done?: string[];
    decisions?: string[];
    openThreads?: string[];
    next?: string;
    stage?: string;
}
export interface Episode {
    file: string;
    at: string;
    stage?: string;
    text: string;
}
/** Save a session summary as .forge/episodes/YYYY-MM-DD-n.md. */
export declare function saveEpisode(root: string, input: EpisodeInput): Episode;
/** Episodes, newest first. */
export declare function listEpisodes(root: string): Episode[];
