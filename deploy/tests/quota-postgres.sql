-- Acceptance assertions. All fixtures are rolled back by the inner exception block.
DO $$
DECLARE e jsonb; rejected boolean; n bigint;
BEGIN
 BEGIN
  INSERT INTO studio_accounts(id,phone,name,password_hash,role,created) VALUES('quota-acceptance','quota-acceptance','额度验收','unused','user',0);
  PERFORM studio_quota_change('quota-acceptance','','limit','text',10000,'',1);
  PERFORM studio_quota_change('quota-acceptance','media:one','reserve','image',2000,'{}',1);
  PERFORM studio_quota_change('quota-acceptance','media:one','reserve','image',9999,'{}',1);
  SELECT count(*) INTO n FROM studio_quota_entries WHERE owner='quota-acceptance';
  IF n<>1 THEN RAISE EXCEPTION 'duplicate reservation'; END IF;
  rejected:=false;
  BEGIN PERFORM studio_quota_change('quota-acceptance','media:overflow','reserve','video',9000,'{}',1); EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%QUOTA_INSUFFICIENT%' THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'overdraft allowed'; END IF;
  e:=studio_quota_change('quota-acceptance','media:one','charge','image',1500,'',2);
  e:=studio_quota_change('quota-acceptance','media:one','charge','image',1500,'',2);
  IF (e->>'charged')::bigint<>1500 THEN RAISE EXCEPTION 'incorrect charge'; END IF;
  e:=studio_quota_change('quota-acceptance','media:one','release','image',0,'',3);
  IF e->>'state'<>'charged' THEN RAISE EXCEPTION 'terminal state changed'; END IF;
  PERFORM studio_quota_change('quota-acceptance','media:cancel','reserve','video',5000,'{}',3);
  PERFORM studio_quota_change('quota-acceptance','media:cancel','release','video',0,'',4);
  SELECT sum(charged) INTO n FROM studio_quota_entries WHERE owner='quota-acceptance';
  IF n<>1500 THEN RAISE EXCEPTION 'incorrect settled total'; END IF;
  rejected:=false;
  BEGIN PERFORM studio_quota_change('quota-acceptance','','limit','text',1000,'',4); EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE '%QUOTA_BELOW_USED%' THEN RAISE; END IF; rejected:=true; END;
  IF NOT rejected THEN RAISE EXCEPTION 'reduced below consumption'; END IF;
  -- A failed job insertion must roll back its reservation too.
  rejected:=false;
  BEGIN PERFORM studio_quota_text_submit('quota-test-job','quota-acceptance','invalid-account',1,'invalid-job','测试',2000,4); EXCEPTION WHEN foreign_key_violation THEN rejected:=true; END;
  IF NOT rejected OR EXISTS(SELECT 1 FROM studio_quota_entries WHERE owner='quota-acceptance' AND request_key='text:invalid-job') THEN RAISE EXCEPTION 'orphan reservation'; END IF;
  RAISE EXCEPTION 'QUOTA_ACCEPTANCE_ROLLBACK';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'QUOTA_ACCEPTANCE_ROLLBACK' THEN RAISE; END IF;
 END;
 IF EXISTS(SELECT 1 FROM studio_accounts WHERE id='quota-acceptance') THEN RAISE EXCEPTION 'fixture persisted'; END IF;
END $$;
