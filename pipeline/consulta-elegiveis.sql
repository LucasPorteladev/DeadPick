SELECT DISTINCT match_id
FROM match_player
WHERE start_time >= TIMESTAMP '2026-11-06 01:00:00'
  AND start_time < TIMESTAMP '2026-11-09 00:00:00'
  AND match_mode = 'Ranked' AND game_mode = 'Normal'
  AND player_rank_initial_display_rank >= 91
  AND winning_team IN ('Team0','Team1')
  AND coalesce(not_scored, false) = false
ORDER BY match_id